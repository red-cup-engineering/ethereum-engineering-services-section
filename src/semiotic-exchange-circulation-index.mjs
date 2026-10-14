import { mkdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { getAddress } from "ethers";

import { readSemioticExchangeEvents } from "./semiotic-exchange-events.mjs";
import { makeNiUri } from "@red-cup-engineering/uri-services-section/ni-uri";
import { writeFileTextSync } from "@red-cup-engineering/computer-file-engineering-services-section/write-file";
import { sha256Hex } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/integrity";
import { semanticId } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";

export const CIRCULATION_CHAIN = "eip155:5615611";
export const V1_BACKFILL_BLOCK = 70n;
export const DEFAULT_EXCHANGE_BLOCK_WINDOW = 1024n;

const number = (value, label) => { const result = BigInt(value); if (result < 0n) throw new TypeError(`${label} must be nonnegative`); return result; };
const hash = (value, label) => { if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value)) throw new TypeError(`${label} must be a block or transaction hash`); return value.toLowerCase(); };
const key = (address, event) => `${CIRCULATION_CHAIN}:${address}:${hash(event.chainPosition.blockHash, "blockHash")}:${hash(event.chainPosition.transactionHash, "transactionHash")}:${event.chainPosition.logIndex}`;
const portable = (value) => typeof value === "bigint" ? value.toString() : ArrayBuffer.isView(value) ? `0x${Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("hex")}` : Array.isArray(value) ? value.map(portable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, portable(child)])) : value;

/** Minimal async KV contract, usable by a file adapter, object store, or SQL adapter. */
export function createFileCirculationStorage(directory) {
  mkdirSync(directory, { recursive: true });
  const path = (name) => join(directory, `${sha256Hex(name)}.json`);
  const manifest = () => { try { return JSON.parse(readFileSync(path("manifest"), "utf8")); } catch (error) { if (error?.code === "ENOENT") return []; throw error; } };
  const write = (name, value) => { writeFileTextSync(path(name), JSON.stringify(value)); };
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
  // A contract is one witness source. Duplicate/case-aliased companions must
  // not count the same chain logs twice or manufacture multiple producers.
  const seen = new Set([primary.address.toLowerCase()]);
  const extra = companions.map((entry, index) => {
    const address = getAddress(entry?.address), key = address.toLowerCase();
    if (seen.has(key)) throw new TypeError("duplicate semiotic exchange contract source");
    seen.add(key);
    return Object.freeze({ address, deploymentBlock: number(entry?.deploymentBlock, `companions[${index}].deploymentBlock`), version: entry?.version ?? 1 });
  });
  return Object.freeze([primary, ...extra]);
}

function carrier(event) {
  if (event.carrier === undefined) return null;
  if (event.carrierNi !== makeNiUri(Uint8Array.from(event.carrier))) throw new Error("event carrier is not verified by its content address");
  return Object.freeze({ id: event.carrierNi, hex: `0x${Buffer.from(event.carrier).toString("hex")}` });
}

export function createSemioticExchangeCirculationIndex({ storage, chainId = CIRCULATION_CHAIN, exchange, companions = [], readEvents = readSemioticExchangeEvents, getBlock, getContractState = async () => null, rollbackBlocks = 32n, blockWindow = DEFAULT_EXCHANGE_BLOCK_WINDOW } = {}) {
  if (chainId !== CIRCULATION_CHAIN) throw new TypeError(`circulation index requires ${CIRCULATION_CHAIN}`);
  storage = storageContract(storage);
  if (typeof readEvents !== "function" || typeof getBlock !== "function" || typeof getContractState !== "function") throw new TypeError("readEvents, getBlock, and getContractState are required functions");
  const contracts = addresses(exchange, companions), rollback = number(rollbackBlocks, "rollbackBlocks");
  const window = number(blockWindow, "blockWindow");
  if (window < 1n || window > 4096n) throw new RangeError("exchange blockWindow must be an integer from 1 to 4096");
  const checkpointKey = "circulation/checkpoint", eventPrefix = "circulation/event/", carrierPrefix = "circulation/carrier/";

  async function reconcile({ rpcUrl, rpc, finalized } = {}) {
    const head = Object.freeze({ number: number(finalized?.number, "finalized.number"), hash: hash(finalized?.hash, "finalized.hash") });
    const prior = await storage.get(checkpointKey);
    // A checkpoint describes which exchange contracts its cursor covered.
    // A newly installed companion needs its own backfill from deployment,
    // even when the primary's finalized cursor has already advanced.
    // Retiring or renaming an indexed contract without a migration would
    // strand its immutable historical events under the old schema.
    const previousContracts = new Map();
    if (prior) {
      if (prior.chain !== chainId || !Array.isArray(prior.contracts)) {
        throw new TypeError("exchange checkpoint chain and contract sources must be received");
      }
      for (const previous of prior.contracts) {
        const address = getAddress(previous.address).toLowerCase();
        if (previousContracts.has(address)) throw new TypeError("duplicate prior exchange contract");
        previousContracts.set(address, previous);
        if (!contracts.some(current =>
            current.address.toLowerCase() === address &&
            current.deploymentBlock === number(previous.deploymentBlock, "prior deploymentBlock") &&
            current.version === previous.version)) {
          throw new TypeError("previously indexed exchange contract cannot disappear or change without migration");
        }
      }
    }
    let replayFrom = null, reorg = false;
    if (prior) {
      const observed = await getBlock(prior.finalized.number);
      if (hash(observed?.hash, "checkpoint block hash") !== prior.finalized.hash) {
        const priorNumber = number(prior.finalized.number, "checkpoint finalized number");
        reorg = true; replayFrom = priorNumber > rollback ? (priorNumber - rollback > V1_BACKFILL_BLOCK ? priorNumber - rollback : V1_BACKFILL_BLOCK) : V1_BACKFILL_BLOCK;
        for (const name of await storage.list(eventPrefix)) {
          const row = await storage.get(name);
          if (row === null) continue;
          // Persisted block numbers are decimal strings. Lexical ordering
          // deletes pre-reorganization rows across decimal-width boundaries
          // (e.g. "99" >= "100") and silently loses their witnesses.
          if (typeof row.blockNumber !== "string" ||
              !/^(?:0|[1-9][0-9]*)$/u.test(row.blockNumber)) {
            throw new TypeError("indexed event block number must be canonical decimal");
          }
          if (BigInt(row.blockNumber) >= replayFrom) await storage.remove(name);
        }
      }
    }
    const indexed = [];
    for (const contract of contracts) {
      const previouslyIndexed = previousContracts.has(contract.address.toLowerCase());
      const start = previouslyIndexed
        ? (replayFrom ?? number(prior.finalized.number, "prior finalized block") + 1n)
        : contract.deploymentBlock;
      if (start > head.number) continue;
      // Each RPC read covers a bounded closed interval. Historical backfill
      // and chain recovery may span years of blocks, but one provider call
      // must never request the whole head-from-genesis range.
      for (let first = start; first <= head.number; first += window) {
        const last = first + window - 1n > head.number ? head.number : first + window - 1n;
        const events = await readEvents({ rpcUrl, rpc, exchange: contract.address, fromBlock: first, toBlock: last });
        for (const event of events) {
          const position = number(event?.chainPosition?.blockNumber, "event block number");
          if (position < first || position > last) throw new TypeError("exchange reader returned an event outside its requested window");
          const eventKey = `${eventPrefix}${key(contract.address, event)}`, existing = await storage.get(eventKey);
          if (existing) { indexed.push(existing); continue; }
          const verifiedCarrier = carrier(event);
          if (verifiedCarrier && !await storage.get(`${carrierPrefix}${verifiedCarrier.id}`)) await storage.put(`${carrierPrefix}${verifiedCarrier.id}`, verifiedCarrier);
          const row = Object.freeze({ key: eventKey, chain: chainId, address: contract.address, version: contract.version, blockNumber: position.toString(), event: portable(event), carrier: verifiedCarrier });
          await storage.put(eventKey, row); indexed.push(row);
        }
      }
    }
    const state = await getContractState({ exchange: contracts[0].address, companions: contracts.slice(1), finalized: head });
    const checkpoint = Object.freeze({ chain: chainId, contracts: portable(contracts), finalized: Object.freeze({ number: head.number.toString(), hash: head.hash }) });
    await storage.put(checkpointKey, checkpoint);
    const receipt = Object.freeze({ type: "SemioticExchangeCirculationReconciliationReceipt", version: 1, chain: chainId, checkpoint, reorg, replayFrom: replayFrom?.toString() ?? null, indexed: indexed.map(({ key: id }) => id).sort(), contractState: portable(state), signature: null, signatureDisposition: "no external signature claimed" });
    return Object.freeze({ id: semanticId(receipt), ...receipt });
  }
  return Object.freeze({ reconcile });
}
