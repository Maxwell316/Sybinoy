import path from "node:path";
import { setNetworkId } from "@midnight-ntwrk/midnight-js/network-id";

export const currentDir = path.resolve(new URL(import.meta.url).pathname, "..");

export const contractConfig = {
  privateStateStoreName: "private-qf-private-state",
  zkConfigPath: path.resolve(currentDir, "..", "managed", "private_qf")
};

export interface Config {
  readonly logDir: string;
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly proofServer: string;
}

export class PreviewConfig implements Config {
  logDir = path.resolve(currentDir, "..", "logs", "preview", `${new Date().toISOString()}.log`);
  indexer = "https://indexer.preview.midnight.network/api/v3/graphql";
  indexerWS = "wss://indexer.preview.midnight.network/api/v3/graphql/ws";
  node = "https://rpc.preview.midnight.network";
  proofServer = "http://127.0.0.1:6300";
  constructor() {
    setNetworkId("preview");
  }
}

export class PreprodConfig implements Config {
  logDir = path.resolve(currentDir, "..", "logs", "preprod", `${new Date().toISOString()}.log`);
  indexer = "https://indexer.preprod.midnight.network/api/v3/graphql";
  indexerWS = "wss://indexer.preprod.midnight.network/api/v3/graphql/ws";
  node = "https://rpc.preprod.midnight.network";
  proofServer = "http://127.0.0.1:6300";
  constructor() {
    setNetworkId("preprod");
  }
}
