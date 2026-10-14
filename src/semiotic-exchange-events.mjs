import { Interface, getAddress, getBytes, hexlify, isHexString, sha256, toBeHex } from "ethers";
import { jsonRpc } from "./public-evm-ledger.mjs";

export const SEMIOTIC_EXCHANGE_EVENTS_ABI = [
  "event CellSeated(bytes32 indexed cell,address indexed controller,bytes32 indexed law,bytes carrier)",
  "event CellRetired(bytes32 indexed cell,address indexed controller)",
  "event DemandRaised(bytes32 indexed demand,address indexed raiser,bytes32 indexed wantedLaw,bytes32 grounding,bytes carrier)",
  "event DemandOffered(bytes32 indexed demand,bytes32 indexed offer,bytes32 indexed cell,address controller,bytes carrier)",
  "event PurchaseMoved(bytes32 indexed demand,bytes32 indexed offer,bytes32 indexed cell,address raiser,address controller)",
  "event DemandSettled(bytes32 indexed demand,bytes32 indexed cell,address indexed controller,bytes32 result,bytes carrier)",
];

const events = new Interface(SEMIOTIC_EXCHANGE_EVENTS_ABI);
const demandRaised = events.getEvent("DemandRaised");
const eventNames = Object.freeze([
  "CellSeated", "CellRetired", "DemandRaised", "DemandOffered", "PurchaseMoved", "DemandSettled",
]);
const eventTopics = Object.freeze(eventNames.map((name) => events.getEvent(name).topicHash));
const activityTypes = Object.freeze({
  CellSeated: "Create",
  CellRetired: "Update",
  DemandRaised: "Offer",
  DemandOffered: "Offer",
  PurchaseMoved: "Accept",
  DemandSettled: "Announce",
});

function blockNumber(value, name) {
  if (value === undefined || value === null || value === "") {
    throw new TypeError(`${name} is required`);
  }
  const number = typeof value === "bigint" ? value : BigInt(value);
  if (number < 0n) throw new RangeError(`${name} must not be negative`);
  return number;
}

/** Normalize a byte carrier without interpreting its RMN term. */
export function normalizeDemandCarrier(carrier) {
  if (carrier === undefined || carrier === null) throw new TypeError("carrier is required");
  const bytes = getBytes(carrier);
  if (bytes.length === 0) throw new TypeError("carrier must not be empty");
  return Object.freeze({ bytes: new Uint8Array(bytes), hex: hexlify(bytes) });
}

function immutable(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) throw new TypeError("invocation receipt must not contain cycles");
  seen.add(value);
  if (ArrayBuffer.isView(value)) return hexlify(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  if (value instanceof ArrayBuffer) return hexlify(new Uint8Array(value));
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => immutable(entry, seen)));
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, immutable(entry, seen)])));
}

function requireCell(cell, name) {
  if (typeof cell !== "function") throw new TypeError(`${name} must be a function`);
  return cell;
}

/**
 * Read a closed, explicitly bounded interval of on-chain demand moves.
 * The emitted carrier is returned byte-for-byte so an RMN/A2A projector does
 * not need a registry, a local world, or any historical FizzOS state.
 */
export async function readDemandRaised({ rpcUrl, exchange, fromBlock, toBlock, rpc } = {}) {
  if (!rpcUrl) throw new TypeError("rpcUrl is required");
  const address = getAddress(exchange);
  const first = blockNumber(fromBlock, "fromBlock");
  const last = blockNumber(toBlock, "toBlock");
  if (last < first) throw new RangeError("toBlock precedes fromBlock");
  const call = rpc ?? jsonRpc;
  const logs = await call(rpcUrl, "eth_getLogs", [{
    address,
    fromBlock: toBeHex(first),
    toBlock: toBeHex(last),
    topics: [demandRaised.topicHash],
  }]);

  const admitted = logs.map((log) => {
    const decoded = events.parseLog(log);
    const carrier = getBytes(decoded.args.carrier);
    // This specialized reader feeds real A2A hire submission. It must
    // receive the same canonical SHA-256 identity as full event replay,
    // rather than trusting a bare event topic from an RPC response.
    return assertCarrierIdentity({
      kind: "DemandRaised",
      chainPosition: receiveLogPosition(log, address, first, last),
      demand: decoded.args.demand,
      raiser: decoded.args.raiser,
      wantedLaw: decoded.args.wantedLaw,
      grounding: decoded.args.grounding,
      carrier,
      carrierHex: hexlify(carrier),
    });
  });
  admitted.sort(chainOrder);
  return Object.freeze(admitted);
}

function position(log) {
  const block = blockNumber(log.blockNumber, "log.blockNumber");
  const index = blockNumber(log.logIndex, "log.logIndex");
  if (index > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("log index exceeds safe integer range");
  return Object.freeze({
    blockNumber: block,
    blockHash: log.blockHash,
    transactionHash: log.transactionHash,
    logIndex: Number(index),
  });
}
function chainOrder(left, right) {
  return left.chainPosition.blockNumber < right.chainPosition.blockNumber ? -1 :
    left.chainPosition.blockNumber > right.chainPosition.blockNumber ? 1 :
    left.chainPosition.logIndex - right.chainPosition.logIndex;
}

// A provider's eth_getLogs filter is a request, not independent assurance
// that the returned data belong to the queried contract and block interval.
// Authenticate every supplied event coordinate before handing it to A2A
// execution or the circulation index.
function receiveLogPosition(log, contract, first, last) {
  const positionValue = position(log);
  if (getAddress(log?.address) !== contract ||
      log.removed === true ||
      positionValue.blockNumber < first || positionValue.blockNumber > last ||
      !isHexString(positionValue.blockHash, 32) ||
      !isHexString(positionValue.transactionHash, 32)) {
    throw new TypeError("exchange RPC returned a log outside its admitted contract or finalized interval");
  }
  return positionValue;
}

function optionalCarrier(decoded) {
  if (!decoded.fragment.inputs.some(({ name }) => name === "carrier")) return {};
  const carrier = getBytes(decoded.args.carrier);
  return { carrier, carrierHex: hexlify(carrier) };
}

function assertCarrierIdentity(event) {
  if (event.carrier === undefined) return event;
  const identityField = ({ CellSeated: "cell", DemandRaised: "demand", DemandOffered: "offer", DemandSettled: "result" })[event.kind];
  const witnessed = event[identityField]?.toLowerCase();
  const computed = sha256(event.carrier).toLowerCase();
  if (witnessed !== computed) throw new Error(`${event.kind} carrier does not match its canonical content address`);
  return Object.freeze({ ...event, carrierNi: `ni:///sha-256;${Buffer.from(computed.slice(2), "hex").toString("base64url")}` });
}

/**
 * Read the complete public causal history of the Semiotic Exchange over one
 * closed block interval.  No cursor or derived status is retained: callers
 * replay these immutable moves into whatever current face they need.
 */
export async function readSemioticExchangeEvents({ rpcUrl, exchange, fromBlock, toBlock, rpc } = {}) {
  if (!rpcUrl) throw new TypeError("rpcUrl is required");
  const address = getAddress(exchange);
  const first = blockNumber(fromBlock, "fromBlock");
  const last = blockNumber(toBlock, "toBlock");
  if (last < first) throw new RangeError("toBlock precedes fromBlock");
  const call = rpc ?? jsonRpc;
  const logs = await call(rpcUrl, "eth_getLogs", [{
    address,
    fromBlock: toBeHex(first),
    toBlock: toBeHex(last),
    topics: [eventTopics],
  }]);
  const witnessed = logs.map((log) => {
    const decoded = events.parseLog(log);
    const common = { kind: decoded.name, chainPosition: receiveLogPosition(log, address, first, last), ...optionalCarrier(decoded) };
    let event;
    switch (decoded.name) {
      case "CellSeated": event = { ...common, cell: decoded.args.cell, controller: decoded.args.controller, law: decoded.args.law }; break;
      case "CellRetired": return Object.freeze({ ...common, cell: decoded.args.cell, controller: decoded.args.controller });
      case "DemandRaised": event = { ...common, demand: decoded.args.demand, raiser: decoded.args.raiser, wantedLaw: decoded.args.wantedLaw, grounding: decoded.args.grounding }; break;
      case "DemandOffered": event = { ...common, demand: decoded.args.demand, offer: decoded.args.offer, cell: decoded.args.cell, controller: decoded.args.controller }; break;
      case "PurchaseMoved": return Object.freeze({ ...common, demand: decoded.args.demand, offer: decoded.args.offer, cell: decoded.args.cell, raiser: decoded.args.raiser, controller: decoded.args.controller });
      case "DemandSettled": event = { ...common, demand: decoded.args.demand, cell: decoded.args.cell, controller: decoded.args.controller, result: decoded.args.result }; break;
      default: throw new Error(`unsupported SemioticExchange event ${decoded.name}`);
    }
    return assertCarrierIdentity(event);
  });
  witnessed.sort(chainOrder);
  return Object.freeze(witnessed);
}

/** A content-only receipt of one witnessed move, suitable for receiptRmn. */
export function semioticExchangeEventReceipt(event, { chainId, exchange } = {}) {
  if (!eventNames.includes(event?.kind)) throw new TypeError("a known SemioticExchange event is required");
  if (typeof chainId !== "string" || !/^eip155:[1-9][0-9]*$/u.test(chainId)) throw new TypeError("chainId must be an EIP-155 CAIP-2 identifier");
  const receipt = {
    type: "SemioticExchangeEventReceipt",
    version: 1,
    chain: chainId,
    exchange: getAddress(exchange),
    move: event.kind,
    position: {
      blockNumber: event.chainPosition.blockNumber.toString(),
      blockHash: event.chainPosition.blockHash,
      transactionHash: event.chainPosition.transactionHash,
      logIndex: event.chainPosition.logIndex,
    },
  };
  for (const field of ["cell", "controller", "law", "demand", "raiser", "wantedLaw", "grounding", "offer", "result", "carrierHex", "carrierNi"]) {
    if (event[field] !== undefined) receipt[field] = event[field];
  }
  return immutable(receipt);
}

/**
 * Project real exchange moves through the existing receiptRmn -> ActivityPub
 * membrane. The standard projector remains injected so this ledger package
 * does not grow a second ActivityPub implementation.
 */
export async function projectSemioticExchangeActivities({
  witnessed,
  chainId,
  exchange,
  receiptRmn,
  projectRmnActivity,
  origin,
  identifier,
  recipient,
  agentCard,
} = {}) {
  if (!Array.isArray(witnessed)) throw new TypeError("witnessed must be an array");
  requireCell(receiptRmn, "receiptRmn");
  requireCell(projectRmnActivity, "projectRmnActivity");
  return Object.freeze(witnessed.map((event) => {
    const rmn = receiptRmn(semioticExchangeEventReceipt(event, { chainId, exchange }));
    if (!rmn || !(rmn.bytes instanceof Uint8Array)) throw new TypeError("receiptRmn must return canonical bytes");
    return projectRmnActivity({
      type: activityTypes[event.kind], origin, identifier, recipient,
      objectBytes: rmn.bytes, agentCard,
    });
  }));
}

function exactCoordinate(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && typeof value.namespace === "string" && typeof value.tenant === "string" && typeof value.key === "string";
}

function taskRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && typeof value.taskId === "string" && typeof value.tenant === "string"
    && value.envelope?.protocol === "A2A" && value.envelope?.protocolVersion === "1.0";
}

function sameCoordinate(left, right) {
  return left.namespace === right.namespace && left.tenant === right.tenant && left.key === right.key;
}

/**
 * Project the ledger log into the exact source interfaces consumed by the A2A
 * provider. Every read replays public history; every write delegates one
 * canonical causal transition to the supplied chain actuator. Nothing here
 * owns a cursor, database, bucket, filesystem, or signing key.
 *
 * Carrier records are existing A2A task-state records or coordination records,
 * not a parallel blockchain schema. All six exchange moves are additionally
 * visible in the coordination event namespace, including carrierless purchase
 * and retirement moves.
 */
export function createSemioticExchangeA2aSources({ history, decodeCarrier, append, chainId, exchange } = {}) {
  requireCell(history, "history");
  requireCell(decodeCarrier, "decodeCarrier");
  requireCell(append, "append");

  async function projection() {
    const witnessed = await history();
    if (!Array.isArray(witnessed)) throw new TypeError("history must return an array");
    const tasks = [], coordination = [];
    for (const event of witnessed) {
      if (!eventNames.includes(event?.kind)) throw new TypeError("history returned an unknown SemioticExchange move");
      coordination.push(Object.freeze({
        namespace: "semiotic-exchange-events", tenant: "",
        key: `${event.chainPosition.blockNumber.toString()}:${event.chainPosition.logIndex}`,
        value: semioticExchangeEventReceipt(event, { chainId, exchange }),
      }));
      if (event.carrier === undefined) continue;
      const record = await decodeCarrier(event.carrier, event);
      if (record === null || record === undefined) continue;
      if (taskRecord(record)) tasks.push(Object.freeze({ ...structuredClone(record), event }));
      else if (exactCoordinate(record) && (Object.hasOwn(record, "value") || record.removed === true)) coordination.push(Object.freeze({ ...structuredClone(record), event }));
    }
    const latestTasks = [];
    for (const record of tasks) {
      const at = latestTasks.findIndex((candidate) => candidate.taskId === record.taskId && candidate.tenant === record.tenant);
      if (at === -1) latestTasks.push(record); else latestTasks[at] = record;
    }
    const latestCoordination = [];
    for (const record of coordination) {
      const at = latestCoordination.findIndex((candidate) => sameCoordinate(candidate, record));
      if (at === -1) latestCoordination.push(record); else latestCoordination[at] = record;
    }
    return { tasks: latestTasks, coordination: latestCoordination.filter(({ removed }) => removed !== true) };
  }

  const taskSource = Object.freeze({
    async put(record) {
      if (!taskRecord(record)) throw new TypeError("task transition must be one A2A 1.0 task-state record");
      const prior = await this.get({ taskId: record.taskId, tenant: record.tenant });
      return append(Object.freeze({ type: "A2aTaskStateTransition", record: structuredClone(record), causalPredecessor: prior?.sha256 ?? null }));
    },
    async get({ taskId, tenant = "" } = {}) {
      return (await projection()).tasks.find((record) => record.taskId === taskId && record.tenant === tenant);
    },
    async list({ tenant = "" } = {}) {
      return (await projection()).tasks.filter((record) => record.tenant === tenant);
    },
  });
  const coordinationSource = Object.freeze({
    async put(record) {
      if (!exactCoordinate(record) || !Object.hasOwn(record, "value")) throw new TypeError("coordination transition requires one exact coordinate and value");
      const prior = await this.get(record);
      return append(Object.freeze({ type: "A2aCoordinationTransition", record: structuredClone(record), causalPredecessor: prior?.event?.carrierNi ?? null }));
    },
    async get(coordinate) {
      if (!exactCoordinate(coordinate)) throw new TypeError("coordination lookup requires one exact coordinate");
      return (await projection()).coordination.find((record) => sameCoordinate(record, coordinate)) ?? null;
    },
    async list({ namespace, tenant = "" } = {}) {
      return (await projection()).coordination.filter((record) => record.tenant === tenant && (namespace === undefined || record.namespace === namespace));
    },
    async remove(coordinate) {
      if (!exactCoordinate(coordinate)) throw new TypeError("coordination removal requires one exact coordinate");
      const prior = await this.get(coordinate);
      if (prior === null) return undefined;
      return append(Object.freeze({ type: "A2aCoordinationRetraction", record: Object.freeze({ ...coordinate, removed: true }), causalPredecessor: prior.event?.carrierNi ?? null }));
    },
  });
  return Object.freeze({ taskSource, coordinationSource });
}

/** Project each witnessed demand into an existing provider/A2A admission seam. */
export async function projectDemandRaised({ submitDemand, ...read } = {}) {
  if (typeof submitDemand !== "function") throw new TypeError("submitDemand must be a function");
  const demands = await readDemandRaised(read);
  const projections = [];
  for (const demand of demands) projections.push(await submitDemand(demand));
  return Object.freeze({
    witnessed: demands.length,
    projections: Object.freeze(projections),
    nextBlock: blockNumber(read.toBlock, "toBlock") + 1n,
  });
}

/**
 * One cold, finalized interval of DemandRaised moves projected into a hire seam.
 *
 * The three injected cells deliberately remain distinct: `conformHireInput`
 * decodes and re-encodes the RMN/A2A hire input, `selectProvider` chooses its
 * provider, and `submitHire` performs the provider-facing submission.  This
 * function owns neither a cursor nor credentials and never starts a watcher.
 */
export async function invokeFinalizedDemandInterval({
  finalized,
  readDemandRaised: read = readDemandRaised,
  normalizeCarrier = normalizeDemandCarrier,
  conformHireInput,
  selectProvider,
  submitHire,
  ...interval
} = {}) {
  if (finalized !== true) throw new TypeError("a finalized closed interval is required");
  requireCell(read, "readDemandRaised");
  requireCell(normalizeCarrier, "normalizeCarrier");
  requireCell(conformHireInput, "conformHireInput");
  requireCell(selectProvider, "selectProvider");
  requireCell(submitHire, "submitHire");

  const fromBlock = blockNumber(interval.fromBlock, "fromBlock");
  const toBlock = blockNumber(interval.toBlock, "toBlock");
  if (toBlock < fromBlock) throw new RangeError("toBlock precedes fromBlock");
  const witnessed = await read({ ...interval, fromBlock, toBlock });
  if (!Array.isArray(witnessed)) throw new TypeError("readDemandRaised must return an array");

  // Admit the whole observed interval before any provider-facing effect.
  const admitted = [];
  for (const demand of witnessed) {
    const normalized = normalizeCarrier(demand?.carrier);
    if (!normalized || !(normalized.bytes instanceof Uint8Array) || typeof normalized.hex !== "string") {
      throw new TypeError("normalizeCarrier must return canonical bytes and hex");
    }
    const conformed = await conformHireInput(Object.freeze({
      demand,
      carrier: normalized.bytes,
      carrierHex: normalized.hex,
    }));
    if (!conformed || !("hire" in conformed) || !("canonicalCarrier" in conformed)) {
      throw new TypeError("conformHireInput must return hire and canonicalCarrier");
    }
    const canonical = normalizeCarrier(conformed.canonicalCarrier);
    if (canonical.hex !== normalized.hex) {
      throw new Error("DemandRaised carrier is not canonical RMN/A2A hire input");
    }
    admitted.push(Object.freeze({ demand, normalized, hire: conformed.hire }));
  }

  const invocations = [];
  for (const admittedDemand of admitted) {
    const { demand, normalized, hire } = admittedDemand;
    const provider = await selectProvider(Object.freeze({ demand, hire, carrier: normalized.bytes, carrierHex: normalized.hex }));
    if (provider === undefined || provider === null) throw new Error("selectProvider must return a provider");
    const submission = await submitHire(Object.freeze({ demand, hire, provider, carrier: normalized.bytes, carrierHex: normalized.hex }));
    invocations.push(immutable({
      demand: demand.demand,
      chainPosition: demand.chainPosition,
      carrierHex: normalized.hex,
      hire,
      provider,
      submission,
    }));
  }

  return Object.freeze({
    finality: Object.freeze({ status: "finalized", fromBlock, toBlock }),
    witnessed: witnessed.length,
    invocations: Object.freeze(invocations),
    nextBlock: toBlock + 1n,
  });
}
