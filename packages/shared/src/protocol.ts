/** Bumped when the client/server API changes incompatibly. */
export const PROTOCOL_VERSION = 1;

export interface HelloResponse {
  message: string;
  protocolVersion: number;
  tickRate: number;
}
