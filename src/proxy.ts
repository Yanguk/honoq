import {
	queryOptions as tsQueryOptions,
	type UseMutationOptions,
	type UseQueryOptions,
} from "@tanstack/react-query";

import type { ClientRequestOptions } from "hono/client";

import { HTTPError } from "./error";
import { resolveHeaders } from "./headers";
import { buildQueryKey } from "./queryKey";
import type {
	AnyFn,
	HonoQueryFactoryOptions,
	MutationNode,
	QueryNode,
} from "./types";

const TERMINAL_KEYS = new Set(["queryOptions", "queryKey", "mutationOptions"]);

type ResolvedOptions = HonoQueryFactoryOptions & {
	autoIdempotency: boolean;
	parseResponse: NonNullable<HonoQueryFactoryOptions["parseResponse"]>;
};

const DEFAULT_OPTIONS = {
	autoIdempotency: true,
	parseResponse: (res: Response) => {
		if (!res.ok) throw new HTTPError(res);
		return res.json();
	},
} satisfies Partial<HonoQueryFactoryOptions>;

async function callAndParse(
	fn: AnyFn,
	input: unknown,
	headers: Record<string, string> | undefined,
	parseResponse: ResolvedOptions["parseResponse"],
	signal?: AbortSignal,
): Promise<unknown> {
	const requestOptions: ClientRequestOptions = {
		...(headers && { headers }),
		init: { signal },
	};

	const res = await fn(input, requestOptions);

	return parseResponse(res);
}

function makeQueryNode(
	getClientFn: () => AnyFn,
	path: string[],
	defaultHonoOptions: ResolvedOptions,
): QueryNode<AnyFn> {
	return {
		queryOptions(input, options) {
			const { hono: honoOptions = {}, ...restOptions } = options ?? {};

			return tsQueryOptions({
				queryKey: buildQueryKey(path, input),
				queryFn: async ({ signal }) => {
					const h = await resolveHeaders(
						defaultHonoOptions.defaultHeaders,
						honoOptions.headers,
					);

					return callAndParse(
						getClientFn(),
						input,
						h,
						defaultHonoOptions.parseResponse,
						signal,
					);
				},
				...restOptions,
			} as UseQueryOptions);
		},

		queryKey(input) {
			return buildQueryKey(path, input);
		},
	};
}

function makeMutationNode(
	getClientFn: () => AnyFn,
	defaultHonoOptions: ResolvedOptions,
): MutationNode<AnyFn> {
	let idempotencyKey = crypto.randomUUID();

	return {
		mutationOptions: (options) => {
			const { hono: honoOptions = {}, ...restOptions } = options ?? {};

			return {
				mutationFn: async (input: unknown) => {
					const h = await resolveHeaders(
						defaultHonoOptions.defaultHeaders,
						defaultHonoOptions.autoIdempotency === true
							? {
									"Idempotency-Key": idempotencyKey,
								}
							: {},
						honoOptions.headers,
					);

					const result = await callAndParse(
						getClientFn(),
						input,
						h,
						defaultHonoOptions.parseResponse,
					);

					idempotencyKey = crypto.randomUUID();

					return result;
				},
				...restOptions,
			} as UseMutationOptions;
		},
	};
}

function createProxyImp(
	getNode: () => unknown,
	path: string[],
	options: ResolvedOptions,
): unknown {
	return new Proxy(
		{},
		{
			get(_, key: string) {
				if (TERMINAL_KEYS.has(key)) {
					const httpMethodKey = path[path.length - 1];

					// getNode() 는 이미 $get / $post 함수 자체이므로 재인덱싱 불필요
					const getClientFn = getNode as () => AnyFn;

					if (httpMethodKey === "$get") {
						const node = makeQueryNode(getClientFn, path, options);
						return node[key as keyof QueryNode<AnyFn>];
					}

					const node = makeMutationNode(getClientFn, options);
					return node[key as keyof MutationNode<AnyFn>];
				}

				const nextPath = [...path, key];
				const getNextNode = () => (getNode() as Record<string, unknown>)[key];

				return createProxyImp(getNextNode, nextPath, options);
			},
		},
	);
}

export function createProxy(
	getNode: () => unknown,
	path: string[],
	options: HonoQueryFactoryOptions,
): unknown {
	const resolvedOptions: ResolvedOptions = { ...DEFAULT_OPTIONS, ...options };

	return createProxyImp(getNode, path, resolvedOptions);
}
