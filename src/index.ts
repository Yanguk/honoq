export { HTTPError } from "./error";
export type {
	HeadersFactory,
	HonoQueryClient,
	HonoQueryFactoryOptions,
	MutationCallOptions,
	MutationNode,
	QueryCallOptions,
	QueryNode,
} from "./types";

import { createProxy } from "./proxy";
import type { HonoQueryClient, HonoQueryFactoryOptions } from "./types";

export function createHonoQuery<T extends object>(
	client: T,
	options?: HonoQueryFactoryOptions,
): HonoQueryClient<T> {
	return createProxy(() => client, [], options ?? {}) as HonoQueryClient<T>;
}
