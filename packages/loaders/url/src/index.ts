import { introspectionQuery, buildClientSchema, parse, IntrospectionQuery, ExecutionResult, print } from 'graphql';
import { SchemaPointerSingle, Source, printSchemaWithDirectives, DocumentLoader, fixSchemaAst } from '@graphql-toolkit/common';
import { isUri } from 'valid-url';
import { fetch as crossFetch } from 'cross-fetch';
import { makeRemoteExecutableSchema } from '@kamilkisiela/graphql-tools';

export type FetchFn = typeof import('cross-fetch').fetch;

type Headers = Record<string, string> | Array<Record<string, string>>;

export interface LoadFromUrlOptions {
  headers?: Headers;
  customFetch?: FetchFn | string;
  method?: 'GET' | 'POST';
}

export class UrlLoader implements DocumentLoader<LoadFromUrlOptions> {
  loaderId(): string {
    return 'url';
  }

  async canLoad(pointer: SchemaPointerSingle, options: LoadFromUrlOptions): Promise<boolean> {
    return !!isUri(pointer);
  }

  async load(pointer: SchemaPointerSingle, options: LoadFromUrlOptions): Promise<Source> {
    let headers = {};
    let fetch = crossFetch;
    let method: 'GET' | 'POST' = 'POST';

    if (options) {
      if (Array.isArray(options.headers)) {
        headers = options.headers.reduce((prev: object, v: object) => ({ ...prev, ...v }), {});
      } else if (typeof options.headers === 'object') {
        headers = options.headers;
      }

      if (options.customFetch) {
        if (typeof options.customFetch === 'string') {
          const [moduleName, fetchFnName] = options.customFetch.split('#');
          fetch = await import(moduleName).then(module => (fetchFnName ? module[fetchFnName] : module));
        }
      }

      if (options.method) {
        method = options.method;
      }
    }

    let extraHeaders = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...headers,
    };

    const fetcher = async ({ query: queryDocument, variables, operationName, context }) => {
      const query = typeof queryDocument === 'string' ? queryDocument : print(queryDocument);
      const fetchResult = await fetch(pointer, {
        method,
        ...(method === 'POST'
          ? {
              body: JSON.stringify({ query, variables, operationName }),
            }
          : {}),
        headers: extraHeaders,
      });
      return fetchResult.json();
    };

    const body: ExecutionResult = await fetcher({ query: introspectionQuery, variables: {}, operationName: 'introspection', context: {} });

    let errorMessage;

    if (body.errors && body.errors.length > 0) {
      errorMessage = body.errors.map((item: Error) => item.message).join(', ');
    } else if (!body.data) {
      errorMessage = body;
    }

    if (errorMessage) {
      throw new Error('Unable to download schema from remote: ' + errorMessage);
    }

    if (!body.data.__schema) {
      throw new Error('Invalid schema provided!');
    }

    const clientSchema = buildClientSchema(body.data as IntrospectionQuery, options as any);
    const remoteExecutableSchema = makeRemoteExecutableSchema({
      schema: clientSchema,
      fetcher,
    });
    const schema = fixSchemaAst(remoteExecutableSchema, options as any);

    return {
      location: pointer,
      get document() {
        return parse(printSchemaWithDirectives(schema));
      },
      schema,
    };
  }
}
