import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress, sha256 } from "ethers";

import { readSemioticExchangeEvents } from "./semiotic-exchange-events.mjs";

export const CIRCULATION_CHAIN = "eip155:5615611";
export const V1_BACKFILL_BLOCK = 70n;

const canonical = (value) => typeof value === "bigint" ? `{"$bigint":${JSON.stringify(value.toString())}}` : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const contentId = (value) => `urn:sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
const number = (value, label) => { const result = BigInt(value); if (result < 0n) throw new TypeError(`${label} must be nonnegative`); return result; };
const hash = (value, label) => { if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value)) throw new TypeError(`${label} must be a block or transaction hash`); return value.toLowerCase(); };
const key = (address, event) => `${CIRCULATION_CHAIN}:${address}:${hash(event.chainPosition.blockHash, "blockHash")}:${hash(event.chainPosition.transactionHash, "transactionHash")}:${event.chainPosition.logIndex}`;
const portable = (value) => typeof value === "bigint" ? value.toString() : ArrayBuffer.isView(value) ? `0x${Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("hex")}` : Array.isArray(value) ? value.map(portable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, portable(child)])) : value;

/** Minimal async KV contract, usable by a file adapter, object store, or SQL adapter. */
export function createFileCirculationStorage(directory) {
  mkdirSync(directory, { recursive: true });
  const path = (name) => join(directory, `${createHash("sha256").update(name).digest("hex")}.json`);
  const manifest = () => { try { return JSON.parse(readFileSync(path("manifest"), "utf8")); } catch (error) { if (error?.code === "ENOENT") return []; throw error; } };
  const write = (name, value) => { const target = path(name), temporary = `${target}.tmp`; writeFileSync(temporary, JSON.stringify(value)); renameSync(temporary, target); };
  return Object.freeze({
    async get(name) { try { return JSON.parse(readFileSync(path(name), "utf8")); } catch (error) { if (error?.code === "ENOENT") return null; throw error; } },
    async put(name, value) { write(name, value); if (name !== "manifest") { const names = manifest(); if (!names.includes(name)) write("manifest", [...names, name].sort()); } },
    async remove(name) { try { renameSync(path(name), `${path(name)}.deleted`); } catch (error) { if (error?.code !== "ENOENT") throw error; } if (name !== "manifest") write("manifest", manifest().filter((entry) => entry !== name)); },
    async list(prefix) { return manifest().filter((name) => name.startsWith(prefix)); },
  });
}

function storageContract(storage) {
  for (const method of ["get", "put", "remove", "list"]) if (typeof storage?.[method] !== "function") throw new TypeError(`storage.${method} is required`);
  return storage;
}

function addresses(exchange, companions) {
  const primary = Object.freeze({ address: getAddress(exchange), deploymentBlock: V1_BACKFILL_BLOCK, version: 1 });
  if (!Array.isArray(companions)) throw new TypeError("companions must be an array");
  const extra = companions.map((entry, index) => Object.freeze({ address: getAddress(entry?.address), deploymentBlock: number(entry?.deploymentBlock, `companions[${index}].deploymentBlock`), version: entry?.version ?? 1 }));
  return Object.freeze([primary, ...extra]);
}

function carrier(event) {
  if (event.carrier === undefined) return null;
  const computed = sha256(event.carrier).toLowerCase();
  if (event.carrierNi !== `ni:///sha-256;${Buffer.from(computed.slice(2), "hex").toString("base64url")}`) throw new Error("event carrier is not verified by its content address");
  return Object.freeze({ id: event.carrierNi, hex: `0x${Buffer.from(event.carrier).toString("hex")}` });
}

export function createSemioticExchangeCirculationIndex({ storage, chainId = CIRCULATION_CHAIN, exchange, companions = [], readEvents = readSemioticExchangeEvents, getBlock, getContractState = async () => null, rollbackBlocks = 32n } = {}) {
  if (chainId !== CIRCULATION_CHAIN) throw new TypeError(`circulation index requires ${CIRCULATION_CHAIN}`);
  storage = storageContract(storage);
  if (typeof readEvents !== "function" || typeof getBlock !== "function" || typeof getContractState !== "function") throw new TypeError("readEvents, getBlock, and getContractState are required functions");
  const contracts = addresses(exchange, companions), rollback = number(rollbackBlocks, "rollbackBlocks");
  const checkpointKey = "circulation/checkpoint", eventPrefix = "circulation/event/", carrierPrefix = "circulation/carrier/";

  async function reconcile({ rpcUrl, rpc, finalized } = {}) {
    const head = Object.freeze({ number: number(finalized?.number, "finalized.number"), hash: hash(finalized?.hash, "finalized.hash") });
    // Never let an injected/fabricated tip advance the economic event ledger.
    // A caller's "finalized" label is only a claim until the selected chain
    // reader independently confirms that block's exact hash.
    const observedHead = await getBlock(head.number);
    if (hash(observedHead?.hash, "observed finalized block hash") !== head.hash) {
      throw new Error("Semiotic Exchange finalized checkpoint disagrees with the observed chain");
    }
    const prior = await storage.get(checkpointKey);
    let replayFrom = null, reorg = false;
    const staleKeys = [];
    if (prior) {
      const priorNumber = number(prior.finalized.number, "checkpoint finalized number");
      if (priorNumber > head.number) throw new Error("Semiotic Exchange finalized checkpoint must not regress");
      const observed = await getBlock(priorNumber);
      if (hash(observed?.hash, "checkpoint block hash") !== prior.finalized.hash) {
        reorg = true;
        replayFrom = priorNumber > rollback
          ? (priorNumber - rollback > V1_BACKFILL_BLOCK ? priorNumber - rollback : V1_BACKFILL_BLOCK)
          : V1_BACKFILL_BLOCK;
        // Observe the entire prior suffix without changing it. Comparing decimal
        // block heights as strings loses the numerical order at digit boundaries.
        for (const name of await storage.list(eventPrefix)) {
          const row = await storage.get(name);
          if (row && number(row.blockNumber, "stored event block number") >= replayFrom) staleKeys.push(name);
        }
      }
    }
    // Stage and independently verify all replacement events and contract state
    // before deleting ANY historic event in a reorg or writing new evidence.
    const staged = [];
    const observedBlockHashes = new Map([[head.number.toString(), head.hash]]);
    const canonicalHashAt = async (at) => {
      const id = at.toString();
      if (!observedBlockHashes.has(id)) {
        observedBlockHashes.set(id, hash((await getBlock(at))?.hash, "canonical event block hash"));
      }
      return observedBlockHashes.get(id);
    };
    const seen = new Set();
    for (const contract of contracts) {
      const start = replayFrom ?? (prior ? BigInt(prior.finalized.number) + 1n : contract.deploymentBlock);
      if (start > head.number) continue;
      const events = await readEvents({ rpcUrl, rpc, exchange: contract.address, fromBlock: start, toBlock: head.number });
      if (!Array.isArray(events)) throw new TypeError("Semiotic Exchange event reader must return a bounded event array");
      for (const event of events) {
        const position = event?.chainPosition;
        const at = number(position?.blockNumber, "event block number");
        if (at < start || at > head.number) throw new Error("Semiotic Exchange event lies outside its queried interval");
        if (hash(position.blockHash, "event block hash") !== await canonicalHashAt(at)) {
          throw new Error("Semiotic Exchange event block hash disagrees with the observed canonical chain");
        }
        if (!Number.isSafeInteger(position.logIndex) || position.logIndex < 0) {
          throw new TypeError("Semiotic Exchange log index must be a nonnegative safe integer");
        }
        const eventKey = `${eventPrefix}${key(contract.address, event)}`;
        if (seen.has(eventKey)) throw new Error("Semiotic Exchange event reader repeated one event identity");
        seen.add(eventKey);
        const verifiedCarrier = carrier(event);
        const old = reorg && at >= replayFrom ? null : await storage.get(eventKey);
        if (old) continue;
        staged.push(Object.freeze({
          key: eventKey, chain: chainId, address: contract.address, version: contract.version,
          blockNumber: at.toString(), event: portable(event), carrier: verifiedCarrier,
        }));
      }
    }
    const state = await getContractState({ exchange: contracts[0].address, companions: contracts.slice(1), finalized: head });
    // First write the new content-addressed carriers; only after all source
    // checks succeeded may a reorganization retire and replace stored rows.
    for (const row of staged) {
      if (row.carrier && !await storage.get(`${carrierPrefix}${row.carrier.id}`)) {
        await storage.put(`${carrierPrefix}${row.carrier.id}`, row.carrier);
      }
    }
    for (const name of staleKeys) await storage.remove(name);
    for (const row of staged) await storage.put(row.key, row);
    const indexed = staged;
    const checkpoint = Object.freeze({ chain: chainId, contracts: portable(contracts), finalized: Object.freeze({ number: head.number.toString(), hash: head.hash }) });
    await storage.put(checkpointKey, checkpoint);
    const receipt = Object.freeze({ type: "SemioticExchangeCirculationReconciliationReceipt", version: 1, chain: chainId, checkpoint, reorg, replayFrom: replayFrom?.toString() ?? null, indexed: indexed.map(({ key: id }) => id).sort(), contractState: portable(state), signature: null, signatureDisposition: "no external signature claimed" });
    return Object.freeze({ id: contentId(receipt), ...receipt });
  }
  return Object.freeze({ reconcile });
}
