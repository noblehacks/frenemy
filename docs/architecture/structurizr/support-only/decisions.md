# Architecture decisions

## Extend the current relay

Add four dispatch entries and invoke Grok or Cline from the current stdio server. A call holds a slot until it produces one result or error. Existing Claude calls keep their behavior and share the existing process limit with new calls. The server startup directory remains the directory passed to the subprocess.

## Bind to native CLI interfaces

Grok receives one protected prompt file and returns native JSON. Cline receives one prompt through ACP and returns the answer through the same blocking MCP call. Native arguments and protocol decisions express the requested read or explicit write mode. The validation checks observe file effects and refusal. Test results record CLI versions as evidence.

## Resolve selectors inside the existing relay

Each supported tool may receive only the selectors its native agent supports. Caller input takes precedence over the matching per-agent default in `frenemy.config.json`; omission of both leaves the native CLI default unchanged. The adjacent JSON Schema documents the product-owned fields, and startup validation rejects malformed or unknown configuration instead of launching an agent with ambiguous settings. The configuration stores no credentials and does not modify workstation or plugin configuration.

Claude and Grok receive supported model and effort selectors as native argv. Cline ACP 3.0.74 reads provider and model from `CLINE_PROVIDER` and `CLINE_MODEL`, so Frenemy adds those values only to a copied child environment and maps effort to `--thinking`. The parent process environment is not mutated. This agent-specific mapping is covered by the independent R07 contract, production binding tests, and Q02 native qualification with `openai-codex`, `gpt-5.6-luna`, and `high`.

## Keep validation within the server boundary

Windows and Linux runs use suitable test hosts and the CLIs' native authentication. The review assesses the plan, four-level C4 model, binding details, case coverage and baseline compatibility. The operator's environment, plugins, workstation setup and client registrations are outside the integration. Earlier verdicts describe earlier designs and their scope.
