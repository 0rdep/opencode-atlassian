import * as Schema from "effect/Schema"

/**
 * Jira user schema (simplified)
 */
export const JiraUser = Schema.Struct({
  accountId: Schema.String,
  displayName: Schema.optional(Schema.String),
  emailAddress: Schema.optional(Schema.String),
})
export type JiraUser = typeof JiraUser.Type

/**
 * Jira status schema
 */
export const JiraStatus = Schema.Struct({
  name: Schema.String,
  id: Schema.optional(Schema.String),
})
export type JiraStatus = typeof JiraStatus.Type

/**
 * Jira priority schema
 */
export const JiraPriority = Schema.Struct({
  name: Schema.String,
  id: Schema.optional(Schema.String),
})
export type JiraPriority = typeof JiraPriority.Type

/**
 * Jira project schema (simplified)
 */
export const JiraProject = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  name: Schema.String,
})
export type JiraProject = typeof JiraProject.Type

/**
 * Jira issue fields - the essential fields we care about
 * Additional fields are captured in the raw JSON
 */
export const JiraIssueFields = Schema.Struct({
  summary: Schema.String,
  description: Schema.optional(Schema.Unknown), // Can be ADF document or string
  status: JiraStatus,
  priority: Schema.optional(JiraPriority),
  assignee: Schema.optional(Schema.NullOr(JiraUser)),
  reporter: Schema.optional(Schema.NullOr(JiraUser)),
  project: JiraProject,
  created: Schema.optional(Schema.String),
  updated: Schema.optional(Schema.String),
  labels: Schema.optional(Schema.Array(Schema.String)),
})
export type JiraIssueFields = typeof JiraIssueFields.Type

/**
 * Jira issue schema - represents a single issue from the Jira API
 */
export const JiraIssue = Schema.Struct({
  id: Schema.String, // Jira internal ID (e.g., "10001")
  key: Schema.String, // Jira issue key (e.g., "PROJ-123")
  self: Schema.String, // API URL
  fields: JiraIssueFields,
})
export type JiraIssue = typeof JiraIssue.Type

/**
 * Jira search response schema (for /rest/api/3/search/jql endpoint)
 */
export const JiraSearchResponse = Schema.Struct({
  issues: Schema.Array(JiraIssue),
  nextPageToken: Schema.optional(Schema.NullOr(Schema.String)),
  isLast: Schema.optional(Schema.Boolean),
})
export type JiraSearchResponse = typeof JiraSearchResponse.Type

/**
 * Jira comment schema
 */
export const JiraComment = Schema.Struct({
  id: Schema.String,
  body: Schema.optional(Schema.Unknown), // Can be ADF document or string
  author: Schema.optional(Schema.NullOr(JiraUser)),
  created: Schema.optional(Schema.String),
  updated: Schema.optional(Schema.String),
})
export type JiraComment = typeof JiraComment.Type

/**
 * Jira comments response schema (for /rest/api/3/issue/{issueIdOrKey}/comment endpoint)
 */
export const JiraCommentsResponse = Schema.Struct({
  comments: Schema.Array(JiraComment),
  total: Schema.optional(Schema.Number),
  maxResults: Schema.optional(Schema.Number),
  startAt: Schema.optional(Schema.Number),
})
export type JiraCommentsResponse = typeof JiraCommentsResponse.Type
