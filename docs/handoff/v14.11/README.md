# Raydar v14.11 transfer

Current runtime baseline: **14.11, native build 151**. This branch adds handoff documentation to the verified mobile release; it does not change application behavior.

**Newest factual supplement:** [expanded engineer handoff PDF](Raydar-Engineer-Handoff-v14.11-Expanded.pdf) and [searchable answers](ENGINEER-ANSWERS.md). This answers the owner's ten transfer questions using the original **Raydar App** shared chat and relevant screenshots. It resolves previously unknown Mac versions, historical device details, ASC app ID/review history and the reported v14.8 backend deployment. Its explicit evidence qualifications supersede the corresponding unknowns in the earlier completion/setup record. Build 151 archive provenance, Team ID, release keystore and designated live test accounts remain unknown. Regenerate with `python3 docs/handoff/v14.11/build_engineer_answers.py`.

1. Read [BOT-START-HERE.md](BOT-START-HERE.md).
2. Read the [complete PDF](Raydar-Grok-Handoff-v14.11.pdf) or searchable [manual](HANDOFF.md).
3. Check [RELEASE-MANIFEST.json](RELEASE-MANIFEST.json) and [SHA256SUMS.txt](SHA256SUMS.txt).
4. Record remaining device/integration checks in [ACCEPTANCE-CHECKLIST.md](ACCEPTANCE-CHECKLIST.md).

For completed work and setup history, read the [completion and setup PDF](Raydar-Completed-Work-and-Setup-v14.11.pdf) or its [searchable source](COMPLETED-AND-SETUP.md). It covers Xcode, the simulator, automatic signing, the documented existing Raydar Canvassing Apple record/TestFlight group, Android Studio, Android signing, cloud services and development milestones. It distinguishes verified implementation, earlier confirmations, documented existing resources and details still needing confirmation.

This companion was added after the original complete transfer ZIP. Get it from this branch or the separate PDF download; the original platform release packages remain unchanged. Regenerate it with `python3 docs/handoff/v14.11/build_setup_record.py`.

The repository contains the complete rebuildable app source. The owner's complete transfer ZIP additionally includes the unchanged original iOS and Android release ZIPs with prebuilt web assets, plus a tracked-source snapshot. These ZIPs are source/project packages, not signed store binaries. Private configuration and signing credentials must come through the owner's existing secure channel.

Runtime baseline on GitHub: `337461c2a4fd2a66d4c624be1da5c4959fa242a5`, branch `codex/raydar-mobile-v14-11-pin-stability`.

Takeover branch: `codex/raydar-grok-handoff-v14-11`.

To regenerate the PDF after editing the manual, install Python 3 and ReportLab, then run `python3 docs/handoff/v14.11/build_handoff.py`. The generator uses DejaVu fonts when present and falls back to PDF base fonts. Render and inspect every page after changes.

Verification details from the release remain in `docs/mobile-next/VERIFY-V14.11.md` and `.json`. Physical-device compilation/signing, store submission and authenticated production integration checks remain unverified by this transfer.
