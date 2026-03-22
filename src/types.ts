import type {
	QueryKey,
	queryOptions,
	UseMutationOptions,
	UseQueryOptions,
} from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// 내부 타입 헬퍼
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: any
export type AnyFn = (...args: any[]) => any;

export type InferOutput<TFn extends AnyFn> =
	Awaited<ReturnType<TFn>> extends { json(): Promise<infer R> } ? R : never;

export type InferInput<TFn extends AnyFn> = Parameters<TFn>[0] extends undefined
	? undefined
	: Parameters<TFn>[0];

export type GetKeys = "$get";
export type MutationKeys = "$post" | "$put" | "$patch" | "$delete";

// ---------------------------------------------------------------------------
// 헤더 타입
// ---------------------------------------------------------------------------

/**
 * 정적 헤더 객체 또는 동적으로 반환하는 (async) getter 함수.
 *
 * @example
 * // 정적
 * headers: { 'x-api-key': 'secret' }
 *
 * // 동적 (zustand store, cookie 등)
 * headers: () => ({ authorization: `Bearer ${useAuthStore.getState().token}` })
 *
 * // 비동기 동적
 * headers: async () => ({ authorization: `Bearer ${await getToken()}` })
 */
export type HeadersFactory =
	| HeadersInit
	| (() => HeadersInit | Promise<HeadersInit>);

/** createHonoQuery 팩토리 옵션 */
export type HonoQueryFactoryOptions = {
	/** 모든 요청에 자동으로 병합되는 기본 헤더 */
	defaultHeaders?: HeadersFactory;
	autoIdempotency?: boolean;
	/**
	 * 응답 파싱 커스터마이징.
	 * 기본값: `!response.ok` 일 때 `HttpError` throw, 성공 시 `response.json()` 반환
	 *
	 * @example
	 * // 커스텀 에러 메시지 포함
	 * parseResponse: async (res) => {
	 *   if (!res.ok) {
	 *     const body = await res.json();
	 *     throw new MyAppError(res.status, body.message);
	 *   }
	 *   return res.json();
	 * }
	 */
	parseResponse?: (response: Response) => unknown | Promise<unknown>;
};

export type HonoQueryOptions = {
	headers?: HeadersInit;
};

/** queryOptions 호출 레벨 옵션 */
export type QueryCallOptions<TData> = Omit<
	UseQueryOptions<TData>,
	"queryKey" | "queryFn"
> & {
	/** tanstack과 별개인 hono-query-rpc의 설정 */
	hono?: HonoQueryOptions;
};

/** mutationOptions 호출 레벨 옵션 */
export type MutationCallOptions<TData, TInput> = Omit<
	UseMutationOptions<TData, Error, TInput>,
	"mutationFn"
> & {
	/** tanstack과 별개인 hono-query-rpc의 설정 */
	hono?: HonoQueryOptions;
};

// ---------------------------------------------------------------------------
// 퍼블릭 노드 타입
// ---------------------------------------------------------------------------

export type QueryNode<TFn extends AnyFn> = {
	queryOptions(
		input: InferInput<TFn>,
		options?: QueryCallOptions<InferOutput<TFn>>,
	): ReturnType<typeof queryOptions<InferOutput<TFn>>>;

	/**
	 * queryKey 반환 — 수동 invalidate 등에 사용
	 * @example
	 * queryClient.invalidateQueries({ queryKey: api.users.$get.queryKey() })
	 */
	queryKey(input?: InferInput<TFn>): QueryKey;
};

export type MutationNode<TFn extends AnyFn> = {
	mutationOptions(
		options?: MutationCallOptions<InferOutput<TFn>, InferInput<TFn>>,
	): UseMutationOptions<InferOutput<TFn>, Error, InferInput<TFn>>;
};

export type HonoQueryClient<T> = {
	[K in keyof T]: K extends GetKeys
		? T[K] extends AnyFn
			? QueryNode<T[K]>
			: never
		: K extends MutationKeys
			? T[K] extends AnyFn
				? MutationNode<T[K]>
				: never
			: HonoQueryClient<T[K]>;
};
