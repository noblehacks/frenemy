using Nuke.Common;
using Nuke.Common.IO;
using System.Diagnostics;
using System.Text.Json;

/// <summary>
/// Orchestrates the Frenemy Phase 3 BDPv4 test gates.
/// </summary>
/// <remarks>
/// Change log: 2026-11-06, TR-FRENEMY-ADAPTER-118 and
/// AC-FRENEMY-114-01 through AC-FRENEMY-115-06. Added independent mock,
/// native qualification, unit binding, integration binding, group, and full
/// validation targets before production implementation.
/// Change log: 2026-11-07, FR-FRENEMY-117, TR-FRENEMY-ORCH-121,
/// TEST-FRENEMY-117, AC-TR-FRENEMY-ORCH-121-01 through
/// AC-TR-FRENEMY-ORCH-121-06. Added opt-in four-agent mock and live integration
/// targets with explicit executable selection. The live target remains outside
/// ordinary Validate because it makes authenticated external agent calls.
/// </remarks>
partial class Build : NukeBuild
{
    /// <summary>Gets the retained test-run identifier.</summary>
    [Parameter("Stable identifier used beneath TestResults.")]
    readonly string TestRunId = DateTime.Now.ToString("yyyyMMddTHHmmss");

    /// <summary>Gets project-to-test-class selections supplied by TestGroups.</summary>
    [Parameter("Selections formatted as project:Class[,Class...].")]
    readonly string[] Groups = [];

    /// <summary>Gets the explicitly selected native Grok executable for qualification.</summary>
    [Parameter("Absolute native Grok executable used by NativeQualification.")]
    readonly string GrokExecutable = string.Empty;

    /// <summary>Gets the explicitly selected native Cline executable for qualification.</summary>
    [Parameter("Absolute native Cline executable used by NativeQualification.")]
    readonly string ClineExecutable = string.Empty;

    /// <summary>Gets the explicitly selected Claude Code executable for the four-agent integration.</summary>
    [Parameter("Absolute Claude Code executable used by FourAgentReasoningIntegration.")]
    readonly string ClaudeExecutable = string.Empty;

    /// <summary>Gets the explicitly selected Codex executable for the four-agent integration.</summary>
    [Parameter("Absolute Codex executable used by FourAgentReasoningIntegration.")]
    readonly string CodexExecutable = string.Empty;

    /// <summary>Executes the independent correct mocks and negative controls.</summary>
    Target VerifyMocks => _ => _
        .Executes(() => RunRelayTests("VerifyMocks"));

    /// <summary>Executes the four-agent reasoning independent mock and negative-control gate.</summary>
    Target VerifyFourAgentReasoningMocks => _ => _
        .Executes(() => RunRelayTests("VerifyFourAgentReasoningMocks"));

    /// <summary>Executes the native Grok and Cline qualification provider.</summary>
    Target NativeQualification => _ => _
        .DependsOn(VerifyMocks)
        .Executes(() => RunRelayTests("NativeQualification"));

    /// <summary>Executes the production-independent unit contract suite.</summary>
    Target TestUnitRelay => _ => _
        .Executes(() => RunRelayTests("TestUnitRelay"));

    /// <summary>Executes the contract suite through the production MCP entry point.</summary>
    Target TestIntegrationRelay => _ => _
        .Executes(() => RunRelayTests("TestIntegrationRelay"));

    /// <summary>Executes the opt-in authenticated four-agent reasoning integration.</summary>
    Target FourAgentReasoningIntegration => _ => _
        .DependsOn(VerifyFourAgentReasoningMocks)
        .Executes(() => RunRelayTests("FourAgentReasoningIntegration"));

    /// <summary>Executes the selected project and test-class groups.</summary>
    Target TestGroups => _ => _
        .Requires(() => Groups.Length > 0)
        .Executes(() => RunRelayTests("TestGroups"));

    /// <summary>Executes all Phase 3 gates for the current platform.</summary>
    Target Validate => _ => _
        .DependsOn(TestUnitRelay, NativeQualification, TestIntegrationRelay);

    /// <summary>Runs the PowerShell test orchestrator with literal arguments.</summary>
    /// <param name="target">Nuke target being implemented by the orchestrator.</param>
    void RunRelayTests(string target)
    {
        var startInfo = new ProcessStartInfo("pwsh")
        {
            UseShellExecute = false,
            WorkingDirectory = RootDirectory
        };
        startInfo.ArgumentList.Add("-NoLogo");
        startInfo.ArgumentList.Add("-NoProfile");
        startInfo.ArgumentList.Add("-NonInteractive");
        startInfo.ArgumentList.Add("-File");
        startInfo.ArgumentList.Add(RootDirectory / "build" / "Invoke-RelayTests.ps1");
        startInfo.ArgumentList.Add("-Target");
        startInfo.ArgumentList.Add(target);
        startInfo.ArgumentList.Add("-TestRunId");
        startInfo.ArgumentList.Add(TestRunId);

        if (Groups.Length > 0)
        {
            startInfo.ArgumentList.Add("-TestGroupsJson");
            startInfo.ArgumentList.Add(JsonSerializer.Serialize(Groups));
        }
        if (!string.IsNullOrWhiteSpace(GrokExecutable))
        {
            startInfo.ArgumentList.Add("-GrokExecutable");
            startInfo.ArgumentList.Add(GrokExecutable);
        }
        if (!string.IsNullOrWhiteSpace(ClineExecutable))
        {
            startInfo.ArgumentList.Add("-ClineExecutable");
            startInfo.ArgumentList.Add(ClineExecutable);
        }
        if (!string.IsNullOrWhiteSpace(ClaudeExecutable))
        {
            startInfo.ArgumentList.Add("-ClaudeExecutable");
            startInfo.ArgumentList.Add(ClaudeExecutable);
        }
        if (!string.IsNullOrWhiteSpace(CodexExecutable))
        {
            startInfo.ArgumentList.Add("-CodexExecutable");
            startInfo.ArgumentList.Add(CodexExecutable);
        }

        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException("Unable to start the PowerShell test orchestrator.");
        process.WaitForExit();
        if (process.ExitCode != 0)
            throw new InvalidOperationException($"PowerShell test orchestrator exited with code {process.ExitCode}.");
    }

    /// <summary>Starts Nuke with the independent mock gate as the default target.</summary>
    public static int Main() => Execute<Build>(x => x.VerifyMocks);
}
