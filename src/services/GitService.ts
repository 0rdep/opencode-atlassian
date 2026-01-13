import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

/**
 * Git operation errors
 */
export class GitError extends Schema.TaggedError<GitError>()("GitError", {
  message: Schema.String,
  command: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Git service interface
 */
export interface GitServiceI {
  /**
   * Clone a repository to a target directory
   */
  readonly clone: (
    repoUrl: string,
    targetDir: string
  ) => Effect.Effect<void, GitError>

  /**
   * Checkout a new branch from the current HEAD
   */
  readonly checkoutNewBranch: (
    workDir: string,
    branchName: string
  ) => Effect.Effect<void, GitError>

  /**
   * Get the current branch name
   */
  readonly getCurrentBranch: (workDir: string) => Effect.Effect<string, GitError>
}

/**
 * Git service tag
 */
export class GitService extends Context.Tag("GitService")<
  GitService,
  GitServiceI
>() {}

/**
 * Execute a git command using Bun's spawn and handle errors
 */
const runGitCommand = (
  args: readonly string[],
  workDir?: string
): Effect.Effect<string, GitError> =>
  Effect.try({
    try: () => {
      const result = Bun.spawnSync(["git", ...args], {
        cwd: workDir,
        stdout: "pipe",
        stderr: "pipe",
      })

      const stdout = result.stdout.toString().trim()
      const stderr = result.stderr.toString().trim()

      if (result.exitCode !== 0) {
        throw new Error(stderr || `Git command failed with exit code ${result.exitCode}`)
      }

      return stdout
    },
    catch: (error) =>
      new GitError({
        message: error instanceof Error ? error.message : String(error),
        command: `git ${args.join(" ")}`,
        cause: error,
      }),
  })

/**
 * Create the Git service implementation
 */
const makeGitService = (): GitServiceI => ({
  clone: (repoUrl: string, targetDir: string) =>
    runGitCommand(["clone", repoUrl, targetDir]).pipe(
      Effect.asVoid,
      Effect.mapError(
        (error) =>
          new GitError({
            message: `Failed to clone repository: ${error.message}`,
            command: error.command,
            cause: error,
          })
      )
    ),

  checkoutNewBranch: (workDir: string, branchName: string) =>
    runGitCommand(["checkout", "-b", branchName], workDir).pipe(
      Effect.asVoid,
      Effect.mapError(
        (error) =>
          new GitError({
            message: `Failed to create branch ${branchName}: ${error.message}`,
            command: error.command,
            cause: error,
          })
      )
    ),

  getCurrentBranch: (workDir: string) =>
    runGitCommand(["rev-parse", "--abbrev-ref", "HEAD"], workDir).pipe(
      Effect.mapError(
        (error) =>
          new GitError({
            message: `Failed to get current branch: ${error.message}`,
            command: error.command,
            cause: error,
          })
      )
    ),
})

/**
 * Layer that provides the GitService
 */
export const GitServiceLive: Layer.Layer<GitService> = Layer.succeed(
  GitService,
  makeGitService()
)
