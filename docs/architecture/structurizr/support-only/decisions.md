# Architecture decisions

## Extend the current relay

Add four dispatch entries and invoke Grok or Cline from the current stdio server. A call holds a slot until it produces one result or error. Existing Claude calls keep their behavior and share the existing process limit with new calls. The server startup directory remains the directory passed to the subprocess.

## Bind to native CLI interfaces

Grok receives one protected prompt file and returns native JSON. Cline receives one prompt through ACP and returns the answer through the same blocking MCP call. Native arguments and protocol decisions express the requested read or explicit write mode. The validation checks observe file effects and refusal. Test results record CLI versions as evidence.

## Keep validation within the server boundary

Windows and Linux runs use suitable test hosts and the CLIs' native authentication. The review assesses the plan, four-level C4 model, binding details, case coverage and baseline compatibility.
