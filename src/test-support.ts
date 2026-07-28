export interface FetchCall {
  arguments: Parameters<typeof fetch>;
}

export interface FetchSpy {
  fetch: typeof fetch;
  mock: {
    calls: FetchCall[];
  };
}

/** Creates a runtime-neutral fetch spy for Node.js and Bun tests. */
export function createFetchSpy(
  respond: (...args: Parameters<typeof fetch>) => Response | Promise<Response> = () =>
    Response.json({}),
): FetchSpy {
  const calls: FetchCall[] = [];
  const spy: typeof fetch = async (...args) => {
    calls.push({ arguments: args });
    return respond(...args);
  };

  return {
    fetch: spy,
    mock: { calls },
  };
}
