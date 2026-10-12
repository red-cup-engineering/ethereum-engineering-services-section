export function loadExactEnvironment(path: string, env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export function prepareEffectAuthority(declaration: Record<string, unknown>, env?: NodeJS.ProcessEnv): Record<string, unknown>;
export function signEffectAuthority(authority: unknown, controllerPrivateKey: string): string;
export function acceptEffectReceipt(authority: unknown, receipt: unknown): Readonly<Record<string, unknown>>;
export function consumeEffectAuthority(authority: unknown, sourceSignature: string, providerControllerPrivateKey: string, env?: NodeJS.ProcessEnv): Readonly<{
  profile: string;
  chain: string;
  seamId: string;
  seam: Record<string, unknown>;
  sourceSigner: string;
  targetSigner: string;
  sourceSignature: string;
  targetSignature: string;
  receiptId: string;
}>;
