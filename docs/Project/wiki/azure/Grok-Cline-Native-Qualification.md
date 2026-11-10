# Native CLI validation for the existing relay

Validate the native invocation described in [the binding contract](https://github.com/sharpninja/frenemy/blob/main/docs/contracts/grok-cline-support.md) on Windows and Linux using suitable test hosts. Record host OS, executable and CLI version in the test receipt so results can be reproduced. CLI discovery and support do not depend on a release-time binary manifest or per-call identity probe.

After architecture acceptance and the independent mock gate, use harmless fixture workspaces and self-contained prompts to verify the native CLI's prompt input, read and write controls, result shape and failure modes. A read fixture attempts an edit or shell action. Check both the refusal and unchanged sentinel state. An explicit write fixture checks the permitted file operation and its resulting bytes. Check Grok prompt protection before any prompt write. Check Cline ACP permission requests, offered options, and completion through the same assertion data that the production tests use.

This is a test of Frenemy's native arguments and protocol responses. The operator's environment, plugins, account configuration and machine inventory are excluded. The test uses a configured native CLI as a prerequisite. Test setup may use harmless stubs or dedicated test fixtures for deterministic failure cases. It does not register plugins, change host policies or expand the product's setup surface.

A CLI route that cannot enforce the promised tool mode or return a valid result fails its native check. Report the observed native limitation with the command and output. Readiness review verifies this plan and its evidence boundary. Native and production results belong to the later implementation gate.
