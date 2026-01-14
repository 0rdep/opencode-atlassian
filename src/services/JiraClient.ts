import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Redacted from "effect/Redacted";
import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import {
  AtlassianConfigService,
  type AtlassianConfig,
} from "../config/Config.ts";
import {
  type JiraIssue,
  JiraSearchResponse,
  type JiraComment,
  JiraCommentsResponse,
} from "../schema/JiraIssue.ts";

/**
 * Error types for Jira client
 */
export class JiraClientError extends Schema.TaggedError<JiraClientError>()(
  "JiraClientError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  }
) {}

/**
 * Jira client service interface
 */
export interface JiraClientService {
  /**
   * Search for issues using JQL
   */
  readonly searchIssues: (
    jql: string
  ) => Effect.Effect<readonly JiraIssue[], JiraClientError>;

  /**
   * Search for issues assigned to the configured assignee with the configured status
   */
  readonly searchAssignedIssues: () => Effect.Effect<
    readonly JiraIssue[],
    JiraClientError
  >;

  /**
   * Get comments for a specific issue
   */
  readonly getIssueComments: (
    issueKey: string
  ) => Effect.Effect<readonly JiraComment[], JiraClientError>;

  /**
   * Transition an issue to a new status
   */
  readonly transitionIssue: (
    issueKey: string,
    statusName: string
  ) => Effect.Effect<void, JiraClientError>;

  /**
   * Add a comment to an issue
   */
  readonly addComment: (
    issueKey: string,
    body: string
  ) => Effect.Effect<void, JiraClientError>;
}

/**
 * Jira client service tag
 */
export class JiraClient extends Context.Tag("JiraClient")<
  JiraClient,
  JiraClientService
>() {}

/**
 * Create Basic Auth header value
 */
const makeBasicAuth = (email: string, apiToken: string): string => {
  const credentials = `${email}:${apiToken}`;
  return `Basic ${btoa(credentials)}`;
};

/**
 * Decode the JiraSearchResponse schema
 */
const decodeSearchResponse = Schema.decodeUnknown(JiraSearchResponse);

/**
 * Decode the JiraCommentsResponse schema
 */
const decodeCommentsResponse = Schema.decodeUnknown(JiraCommentsResponse);

/**
 * Create the Jira client service implementation
 */
const makeJiraClientService = (
  config: AtlassianConfig,
  httpClient: HttpClient.HttpClient
): JiraClientService => {
  const baseUrl = `https://${config.domain}/rest/api/3`;

  const searchIssues = (
    jql: string
  ): Effect.Effect<readonly JiraIssue[], JiraClientError> =>
    Effect.gen(function* () {
      const allIssues: JiraIssue[] = [];
      let nextPageToken = "";

      // Paginate through all results
      do {
        const request = HttpClientRequest.get(`${baseUrl}/search/jql`).pipe(
          HttpClientRequest.appendUrlParam("jql", jql),
          HttpClientRequest.appendUrlParam("maxResults", "50"),
          HttpClientRequest.appendUrlParam("fields", "*all"),
          HttpClientRequest.appendUrlParam("nextPageToken", nextPageToken),
          HttpClientRequest.basicAuth(
            config.email,
            Redacted.value(config.apiToken)
          ),
          HttpClientRequest.setHeader("Accept", "application/json")
        );

        // Execute request
        const res = yield* httpClient.execute(request).pipe(
          Effect.mapError(
            (error) =>
              new JiraClientError({
                message: `HTTP request failed: ${error}`,
                cause: error,
              })
          ),
          Effect.scoped
        );

        if (res.status >= 400) {
          return yield* Effect.fail(
            new JiraClientError({
              message: `Jira API returned ${res.status}`,
            })
          );
        }

        // Parse JSON from response
        const json = yield* res.json.pipe(
          Effect.mapError(
            (error) =>
              new JiraClientError({
                message: `Failed to parse JSON response: ${error}`,
                cause: error,
              })
          )
        );

        const response = yield* decodeSearchResponse(json).pipe(
          Effect.mapError(
            (error) =>
              new JiraClientError({
                message: `Failed to decode Jira response: ${error}`,
                cause: error,
              })
          )
        );

        allIssues.push(...response.issues);
        nextPageToken = response.nextPageToken ?? "";

        // Check if this is the last page
        if (response.isLast === true) {
          break;
        }
      } while (nextPageToken);

      return allIssues as readonly JiraIssue[];
    });

  const searchAssignedIssues = (): Effect.Effect<
    readonly JiraIssue[],
    JiraClientError
  > => {
    // Build JQL query: assignee = currentUser() AND status = "{status}" ORDER BY updated DESC
    const jql = `assignee = currentUser() AND status = "${config.jiraStatus}" ORDER BY updated DESC`;
    return searchIssues(jql);
  };

   const getIssueComments = (
     issueKey: string
   ): Effect.Effect<readonly JiraComment[], JiraClientError> =>
     Effect.gen(function* () {
       const request = HttpClientRequest.get(
         `${baseUrl}/issue/${issueKey}/comment`
       ).pipe(
         HttpClientRequest.appendUrlParam("maxResults", "100"),
         HttpClientRequest.appendUrlParam("orderBy", "created"),
         HttpClientRequest.basicAuth(
           config.email,
           Redacted.value(config.apiToken)
         ),
         HttpClientRequest.setHeader("Accept", "application/json")
       );

       const res = yield* httpClient.execute(request).pipe(
         Effect.mapError(
           (error) =>
             new JiraClientError({
               message: `HTTP request failed: ${error}`,
               cause: error,
             })
         ),
         Effect.scoped
       );

       if (res.status >= 400) {
         return yield* Effect.fail(
           new JiraClientError({
             message: `Jira API returned ${res.status} for comments`,
           })
         );
       }

       const json = yield* res.json.pipe(
         Effect.mapError(
           (error) =>
             new JiraClientError({
               message: `Failed to parse JSON response: ${error}`,
               cause: error,
             })
         )
       );

       const response = yield* decodeCommentsResponse(json).pipe(
         Effect.mapError(
           (error) =>
             new JiraClientError({
               message: `Failed to decode comments response: ${error}`,
               cause: error,
             })
         )
       );

       return response.comments as readonly JiraComment[];
     });

   const transitionIssue = (
     issueKey: string,
     statusName: string
   ): Effect.Effect<void, JiraClientError> =>
     Effect.gen(function* () {
       // First, fetch available transitions for this issue
       const transitionsUrl = `${baseUrl}/issue/${issueKey}/transitions`;
       const transitionsRequest = HttpClientRequest.get(transitionsUrl).pipe(
         HttpClientRequest.basicAuth(
           config.email,
           Redacted.value(config.apiToken)
         ),
         HttpClientRequest.setHeader("Accept", "application/json")
       );

       const transitionsRes = yield* httpClient.execute(transitionsRequest).pipe(
         Effect.mapError(
           (error) =>
             new JiraClientError({
               message: `HTTP request failed when fetching transitions: ${error}`,
               cause: error,
             })
         ),
         Effect.scoped
       );

       if (transitionsRes.status >= 400) {
         return yield* Effect.fail(
           new JiraClientError({
             message: `Jira API returned ${transitionsRes.status} when fetching transitions`,
           })
         );
       }

       const transitionsJson = yield* transitionsRes.json.pipe(
         Effect.mapError(
           (error) =>
             new JiraClientError({
               message: `Failed to parse transitions response: ${error}`,
               cause: error,
             })
         )
       );

       // Find the transition ID for the desired status
       const transitionsData = transitionsJson as {
         transitions?: Array<{ id: string; name: string }>
       };
       const transitions = transitionsData.transitions ?? [];
       const transition = transitions.find(
         (t) => t.name.toLowerCase() === statusName.toLowerCase()
       );

       if (!transition) {
         return yield* Effect.fail(
           new JiraClientError({
             message: `No transition found to status "${statusName}" for issue ${issueKey}. Available: ${transitions.map((t) => t.name).join(", ")}`,
           })
         );
       }

       // Now perform the transition
       const transitionRequest = HttpClientRequest.post(transitionsUrl).pipe(
         HttpClientRequest.basicAuth(
           config.email,
           Redacted.value(config.apiToken)
         ),
         HttpClientRequest.setHeader("Content-Type", "application/json"),
         HttpClientRequest.setHeader("Accept", "application/json")
       );

       const transitionWithBody = yield* HttpClientRequest.bodyJson(
         transitionRequest,
         {
           transition: {
             id: transition.id,
           },
         }
       ).pipe(
         Effect.mapError(
           (error) =>
             new JiraClientError({
               message: `Failed to encode transition request body: ${error}`,
               cause: error,
             })
         )
       );

       const transitionResponse = yield* httpClient.execute(transitionWithBody).pipe(
         Effect.mapError(
           (error) =>
             new JiraClientError({
               message: `HTTP request failed when transitioning: ${error}`,
               cause: error,
             })
         ),
         Effect.scoped
       );

        if (transitionResponse.status >= 400) {
          return yield* Effect.fail(
            new JiraClientError({
              message: `Jira API returned ${transitionResponse.status} when transitioning to "${statusName}"`,
            })
          );
        }
      });

    const addComment = (
      issueKey: string,
      body: string
    ): Effect.Effect<void, JiraClientError> =>
      Effect.gen(function* () {
        const commentUrl = `${baseUrl}/issue/${issueKey}/comment`;
        const request = HttpClientRequest.post(commentUrl).pipe(
          HttpClientRequest.basicAuth(
            config.email,
            Redacted.value(config.apiToken)
          ),
          HttpClientRequest.setHeader("Content-Type", "application/json"),
          HttpClientRequest.setHeader("Accept", "application/json")
        );

        // Jira API v3 uses ADF (Atlassian Document Format) for comments
        const requestWithBody = yield* HttpClientRequest.bodyJson(request, {
          body: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: body,
                  },
                ],
              },
            ],
          },
        }).pipe(
          Effect.mapError(
            (error) =>
              new JiraClientError({
                message: `Failed to encode comment request body: ${error}`,
                cause: error,
              })
          )
        );

        const res = yield* httpClient.execute(requestWithBody).pipe(
          Effect.mapError(
            (error) =>
              new JiraClientError({
                message: `HTTP request failed when adding comment: ${error}`,
                cause: error,
              })
          ),
          Effect.scoped
        );

        if (res.status >= 400) {
          return yield* Effect.fail(
            new JiraClientError({
              message: `Jira API returned ${res.status} when adding comment`,
            })
          );
        }
      });

    return {
      searchIssues,
      searchAssignedIssues,
      getIssueComments,
      transitionIssue,
      addComment,
    };
};

/**
 * Create a Layer that provides the JiraClient service
 * Requires AtlassianConfigService and HttpClient
 */
export const JiraClientLive: Layer.Layer<
  JiraClient,
  never,
  AtlassianConfigService | HttpClient.HttpClient
> = Layer.effect(
  JiraClient,
  Effect.gen(function* () {
    const config = yield* AtlassianConfigService;
    const httpClient = yield* HttpClient.HttpClient;
    return makeJiraClientService(config, httpClient);
  })
);
