import * as Schema from "effect/Schema"
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import * as Config from "effect/Config"
import * as Redacted from "effect/Redacted"
import * as Options from "@effect/cli/Options"

/**
 * Atlassian configuration schema using Effect Schema
 */
export const AtlassianConfigSchema = Schema.Struct({
  email: Schema.String.pipe(
    Schema.nonEmptyString({ message: () => "Email is required" })
  ),
  apiToken: Schema.Redacted(Schema.String),
  domain: Schema.String.pipe(
    Schema.nonEmptyString({ message: () => "Domain is required" })
  ),
  jiraStatus: Schema.String.pipe(
    Schema.nonEmptyString({ message: () => "Jira status is required" })
  ),
  interval: Schema.Number.pipe(Schema.positive()),
  concurrency: Schema.Number.pipe(Schema.positive(), Schema.int()),
  repositoryUrl: Schema.String.pipe(
    Schema.nonEmptyString({ message: () => "Repository URL is required" })
  ),
  baseBranch: Schema.String.pipe(
    Schema.nonEmptyString({ message: () => "Base branch is required" })
  ),
})

export type AtlassianConfig = typeof AtlassianConfigSchema.Type

/**
 * Service tag for AtlassianConfig
 */
export class AtlassianConfigService extends Context.Tag("AtlassianConfigService")<
  AtlassianConfigService,
  AtlassianConfig
>() {}

/**
 * CLI Options definitions
 * Each option falls back to environment variable if not provided
 */
export const emailOption = Options.text("email").pipe(
  Options.withAlias("e"),
  Options.withDescription("Atlassian account email"),
  Options.withFallbackConfig(Config.string("ATLASSIAN_EMAIL")),
)

export const tokenOption = Options.redacted("token").pipe(
  Options.withAlias("t"),
  Options.withDescription("Atlassian API token"),
  Options.withFallbackConfig(Config.redacted("ATLASSIAN_API_TOKEN")),
)

export const domainOption = Options.text("domain").pipe(
  Options.withAlias("d"),
  Options.withDescription("Atlassian domain (e.g., mycompany.atlassian.net)"),
  Options.withFallbackConfig(Config.string("ATLASSIAN_DOMAIN")),
)

export const jiraStatusOption = Options.text("jira-status").pipe(
  Options.withAlias("s"),
  Options.withDescription("Jira status to filter issues (e.g., 'In Progress')"),
  Options.withFallbackConfig(Config.string("ATLASSIAN_JIRA_STATUS")),
)

export const intervalOption = Options.integer("interval").pipe(
  Options.withAlias("i"),
  Options.withDescription("Polling interval in seconds"),
  Options.withFallbackConfig(Config.integer("ATLASSIAN_INTERVAL")),
  Options.withDefault(60),
)

export const concurrencyOption = Options.integer("concurrency").pipe(
  Options.withAlias("c"),
  Options.withDescription("Maximum number of parallel task runners"),
  Options.withFallbackConfig(Config.integer("ATLASSIAN_CONCURRENCY")),
  Options.withDefault(5),
)

export const repositoryUrlOption = Options.text("repository-url").pipe(
  Options.withAlias("r"),
  Options.withDescription("Git repository URL to clone for task work"),
  Options.withFallbackConfig(Config.string("REPOSITORY_URL")),
)

export const baseBranchOption = Options.text("base-branch").pipe(
  Options.withAlias("b"),
  Options.withDescription("Base branch to branch from (default: main)"),
  Options.withFallbackConfig(Config.string("BASE_BRANCH")),
  Options.withDefault("main"),
)

/**
 * All options combined for the start command
 */
export const startOptions = {
  email: emailOption,
  token: tokenOption,
  domain: domainOption,
  jiraStatus: jiraStatusOption,
  interval: intervalOption,
  concurrency: concurrencyOption,
  repositoryUrl: repositoryUrlOption,
  baseBranch: baseBranchOption,
}

/**
 * Type for parsed start command options
 */
export interface StartCommandOptions {
  readonly email: string
  readonly token: Redacted.Redacted<string>
  readonly domain: string
  readonly jiraStatus: string
  readonly interval: number
  readonly concurrency: number
  readonly repositoryUrl: string
  readonly baseBranch: string
}

/**
 * Create AtlassianConfig from parsed CLI options
 */
export const makeAtlassianConfig = (
  options: StartCommandOptions
): AtlassianConfig => ({
  email: options.email,
  apiToken: options.token,
  domain: options.domain,
  jiraStatus: options.jiraStatus,
  interval: options.interval,
  concurrency: options.concurrency,
  repositoryUrl: options.repositoryUrl,
  baseBranch: options.baseBranch,
})

/**
 * Create a Layer that provides AtlassianConfigService from CLI options
 */
export const makeConfigLayer = (
  options: StartCommandOptions
): Layer.Layer<AtlassianConfigService> =>
  Layer.succeed(AtlassianConfigService, makeAtlassianConfig(options))
