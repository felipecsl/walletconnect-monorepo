import { ONE_SECOND, SIX_HOURS } from "./time";

export const RELAYER_DEFAULT_PUBLISH_TTL = SIX_HOURS;

export const RELAYER_DEFAULT_PROTOCOL = "waku";

export const REALYER_DEFAULT_LOGGER = "error";

export const RELAYER_DEFAULT_RPC_URL = "wss://relay.walletconnect.com";

export const RELAYER_CONTEXT = "relayer";

export const RELAYER_EVENTS = {
  payload: "relayer_payload",
  connect: "relayer_connect",
  disconnect: "relayer_disconnect",
  error: "relayer_error",
};

export const RELAYER_SUBSCRIPTION_SUFFIX = "_subscription";

export const RELAYER_PROVIDER_EVENTS = {
  payload: "payload",
  connect: "connect",
  disconnect: "disconnect",
  error: "error",
};

export const RELAYER_RECONNECT_TIMEOUT = ONE_SECOND;

export const RELAYER_STORAGE_OPTIONS = {
  database: ":memory:",
};
