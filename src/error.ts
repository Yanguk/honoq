export class HTTPError extends Error {
	readonly status: number;
	readonly statusText: string;
	readonly response: Response;

	constructor(response: Response) {
		super(`[hono-query] HTTP ${response.status}: ${response.statusText}`);
		this.name = "HTTPError";
		this.status = response.status;
		this.statusText = response.statusText;
		this.response = response;
	}
}
