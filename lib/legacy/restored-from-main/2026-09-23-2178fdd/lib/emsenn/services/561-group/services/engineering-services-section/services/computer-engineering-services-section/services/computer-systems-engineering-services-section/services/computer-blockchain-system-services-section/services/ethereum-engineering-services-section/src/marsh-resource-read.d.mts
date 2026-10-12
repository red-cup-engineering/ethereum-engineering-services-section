export type MarshReadBoundary = Readonly<{
  chainId?: number;
  blockNumber: bigint | number | string;
  blockHash?: string;
  blockTimestamp?: bigint | number | string;
}>;

export type MarshResource = Readonly<{
  controller: string;
  kind: string;
  content: string;
  evidence: string;
  sequence: string;
}>;

export type MarshResourceReading = Readonly<{
  marshAddress: string;
  resourceId: string;
  resource: MarshResource | null;
  provenance: Readonly<{
    chainId: number;
    boundary: Readonly<{ chainId: number; blockNumber: string; blockHash: string | null; blockTimestamp: string | null }>;
    providerId: string;
    endpoint: string;
    attempts: readonly unknown[];
    failures: readonly unknown[];
    callCount: number;
  }>;
}>;

export function readMarshResource(input: Readonly<{
  marshAddress: string;
  resourceId: string;
  boundary?: MarshReadBoundary;
}>): Promise<MarshResourceReading>;
