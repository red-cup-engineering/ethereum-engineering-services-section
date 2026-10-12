import { openSettlementSigner } from "./settlement-key-custody.mjs";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;

/**
 * An explicit local-provider adapter for legacy settlement controllers.
 * The ERC-4337 executor never opens a keystore; callers deliberately select
 * this adapter where a local controller remains the intended provider.
 */
export async function createLocalSettlementUserOperationAuthority({ keystorePath, passwordFile, policySigner }) {
  if (!ADDRESS.test(policySigner ?? "")) throw new TypeError("local settlement authority requires the bound policy signer");
  const signer = await openSettlementSigner({ path: keystorePath, passwordFile });
  if (signer.address.toLowerCase() !== policySigner.toLowerCase()) throw new Error("settlement keystore does not match the bound policy signer");
  return Object.freeze({
    custody: "local-settlement-keystore",
    async authorizeUserOperation({ chainId, entryPoint, account, operation, userOpHash }) {
      if (!Number.isSafeInteger(chainId) || chainId < 1 || !ADDRESS.test(entryPoint) || !ADDRESS.test(account) || operation === null || typeof operation !== "object" || !/^0x[0-9a-fA-F]{64}$/u.test(userOpHash ?? "")) {
        throw new TypeError("local settlement authority refuses an invalid UserOperation authorization request");
      }
      return Object.freeze({ type: "LocalSettlementUserOperationAuthorization", account: account.toLowerCase(), userOpHash: userOpHash.toLowerCase() });
    },
    signUserOperationHash: async (userOpHash) => signer.signingKey.sign(userOpHash).serialized,
  });
}
