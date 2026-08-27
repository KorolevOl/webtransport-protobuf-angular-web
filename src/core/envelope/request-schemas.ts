// request-schemas.ts — base -> <Base>Request schema registry (core shared).
import type { DescMessage, MessageInitShape } from '@bufbuild/protobuf';
import {
  LoginRequestSchema,
  RegisterRequestSchema,
  RefreshRequestSchema,
  LogoutRequestSchema,
} from '../../proto-generated/index';
import type { RequestBase } from './envelope-types';

// satisfies = exhaustiveness: new base in proto (next domain) without a
// schema here fails tsc — the plugin must wire its request into the map.
export const REQUEST_SCHEMAS = {
  login: LoginRequestSchema,
  register: RegisterRequestSchema,
  refresh: RefreshRequestSchema,
  logout: LogoutRequestSchema,
} satisfies Record<RequestBase, DescMessage>;

/** Schema (Desc) of the request message for base B. */
export type RequestSchemaOf<B extends RequestBase> = (typeof REQUEST_SCHEMAS)[B];

/** Plain init object accepted by `create` / `EnvelopeClient.call` for base B. */
export type RequestInitOf<B extends RequestBase> = MessageInitShape<RequestSchemaOf<B>>;
