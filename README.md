# Security+ Study

A free, local study workspace for Security+ SY0-701 practice. Work through questions, explore interactive scenarios, review explanations, and track progress. Built with React, Vite, and a small Node.js API as a community study resource and a working portfolio project.

**First release — open for community review.** This is an unofficial, supplementary study aid. Questions, answer keys, explanations, and scores may contain errors or ambiguity. Check uncertain material against current exam objectives, official technical documentation, your licensed training, and your instructor. Practice results do not predict an exam pass. This project is not affiliated with or endorsed by CompTIA and contains no official exam questions or exam dumps.

## What's included

| Study material | Count |
| --- | --- |
| Knowledge questions, including multiple-select items | 857 |
| Interactive exercises | 639 |
| Multi-part performance-based scenarios (PBQs) | 50 |
| Total practice items | 1,546 |
| Assessments | 17 practice exams and one 16-item coverage challenge |

Practice includes matching, ordering, ports and protocols, acronyms, architecture roles, firewall rules, log interpretation, and simulated CLI tasks. Every item appears once across the assessment catalog; retakes reuse those fixed items. Assessment domain counts describe the practice material and do not reproduce an official exam blueprint or scoring formula.

CLI exercises offer command choices, including distractors, compare the selected text with the lab fixture, and display canned output. They never execute your commands. Firewall exercises evaluate simulated rules only.

## Install and start

Requirements: **Node.js 22.12+** (Node.js 24 LTS recommended), npm, Git, and Bash. Use Linux, macOS, or Windows through WSL/Git Bash. Installation downloads dependencies from npm; no API keys or cloud account are required.

```bash
git clone https://github.com/the-vibe-dev/security-plus-study.git
cd security-plus-study
bash install.sh
```

Open **http://127.0.0.1:4173**. **No password or login is required.** The installer installs dependencies, builds the site, loads the included packs, and starts the server in the foreground. Press **Ctrl+C** to stop it.

If you downloaded a source ZIP, extract it and run `bash install.sh` from the extracted project folder.

To start again:

```bash
bash start-local.sh
```

To choose another port:

```bash
PORT=4180 bash start-local.sh
```

The server binds to `127.0.0.1`. The local launcher clears inherited study credentials and configures the matching local origin. This setup is for use on your own computer. One running instance shares server progress among its visitors; use separate data directories for separate learners.

Manual installation without Bash:

```bash
npm ci --include=dev
npm run build
npm run seed
npm start
```

For password-free manual use, leave `NODE_ENV`, `STUDY_USERNAME`, and `STUDY_PASSWORD` unset. Production mode requires credentials. No `.env` file is needed or automatically loaded.

## How to study

1. Start a **Practice Exam** or use **Practice by Skill** for focused work.
2. Explore **PBQ Labs**, **CLI Tools**, **Acronyms**, and **Ports & Protocols**.
3. Read the feedback and use **Review Mistakes** to revisit weak areas.
4. Resume saved sessions and review completed work through **History** and **Progress**.
5. Use **Flag content** or **Flag explanation / answer key** when something needs a closer look.

Timed assessments reveal feedback after submission. Learning practice allows feedback as you work. Ordering and timeline tasks include **Use this order** to confirm a sequence without moving a card. Interrupted saves keep a browser draft; conflicting work from another tab requires an explicit choice before saving over it.

## Review questionable material

**Human Review** collects question and explanation concerns separately from mistakes, bookmarks, and per-attempt revisit markers.

- Flag a question or a displayed explanation, choose a reason, and add an optional task ID, note, or reference.
- Review concerns against trusted documentation, course material, or an instructor's guidance. Record the outcome before resolving a flag; resolving it does not edit the study bank or certify its accuracy.
- Search and filter by Open, In review, or Resolved. The original captured content stays with the flag.
- Export the shown reviews as JSON for inspection or backup.

On a site with a login, flags are saved on the server and can be reviewed from another browser using that login. Anyone with the same login can see them. Use **Copy browser flags to site** to transfer older flags from the browser where they were created. Copying retains existing site flags and the original browser records.

In password-free local use, flags are saved in the browser for that origin. Export them before clearing browser data. Failed saves keep the form open, and stale forms cannot overwrite a newer review.

No report is automatically sent anywhere. Exports do not automatically include learner answers, scores, or attempt IDs, but they do include captured study content and your free-text notes. Check them carefully before sharing, especially with custom imports. Do not include private information, restricted training material, credentials, or real exam questions.

To request a public review, search [GitHub Issues](https://github.com/the-vibe-dev/security-plus-study/issues), then open a [Questionable study content issue](https://github.com/the-vibe-dev/security-plus-study/issues/new?template=content-review.yml). Provide the public item/task ID, explain the concern in your own words, and include a safe reference. **Do not upload a raw Human Review export.** An issue requests review; it is not proof of an error or a guarantee of verification.

## Source material and custom imports

The installer loads all three bundled source archives:

| Archive | Contents |
| --- | --- |
| `security_plus_sy0_701_study_pack.zip` | 300 knowledge questions and 25 PBQs |
| `test_prep_2_security_plus_sy0_701.zip` | 300 knowledge questions and 25 PBQs |
| `security_plus_sy0_701_practical_site_upgrade.zip` | Combined practical bank, answer keys, and fixed exam manifests |

Answer keys are intentionally included for self-study. The running API withholds them from candidate responses until feedback is allowed. This is an educational resource, not a secure proctored exam system.

For your own question bank, use a fresh data directory without running the seed command:

```bash
STUDY_DATA_DIR=./custom-data bash start-local.sh
```

This opens the standard quiz workspace with **Library → Import question file**. The practical workspace uses its structured packs and does not provide that import screen.

Import single-answer questions as CSV:

```csv
question,option_a,option_b,option_c,option_d,correct_option,domain,objective,explanation
Which protocol encrypts web traffic?,HTTP,HTTPS,FTP,Telnet,B,4,4.5,HTTPS protects HTTP traffic with TLS.
```

Or import JSON:

```json
{
  "questions": [{
    "question": "Which protocol encrypts web traffic?",
    "options": ["HTTP", "HTTPS", "FTP", "Telnet"],
    "answer": "HTTPS",
    "domain": "4",
    "explanation": "HTTPS protects HTTP traffic with TLS."
  }]
}
```

Each question needs at least two options and an answer. `domain`, `objective`, and `explanation` are optional. ZIP files may contain supported CSV/JSON files. See [the JSON example](examples/starter-questions.json). Share only original material or content you have permission to distribute.

## Data and privacy

Imported libraries, server progress, and authenticated Human Review flags live in `data/` by default. Set `STUDY_DATA_DIR` to choose another location and use that same value whenever you restart the app. Back up this directory to preserve server data. Browser sessions and browser-only flags require a separate browser backup or export.

Re-running the installer preserves existing content and progress for the same study-bank version. Use separate data directories for different versions so saved attempts retain their original material. An administrator upgrading a shared installation can preserve the previous `practical-content.json` under `content-archive/<SHA-256 of its version string>.json` in the same data directory before replacing the current bank. Saved attempts use their original bank; new practice uses the current bank. Keep these archives with your data backups. If an original bank is missing, the app refuses to regrade that attempt with a different bank.

The application does not send questions or progress to a third-party API. Fonts and assets are bundled locally. Installation contacts npm. Credentials, `.env` files, local data, dependencies, build output, unrelated archives, and private deployment records are excluded from Git.

`PORT` defaults to `4173`. `STUDY_ORIGIN` controls permitted browser mutation origins and defaults to the local server URL. Command-line API mutation requests must send `X-Study-Request: 1`.

## Development and validation

```bash
npm ci --include=dev
npm run practical:validate
npm run build
npm run check
```

Checks cover pack structure, imports, item grading, renderers, assessment save/resume, browser drafts, API origin checks, and local Human Review storage. Passing tests demonstrate the tested behavior and internal consistency; they do not establish factual accuracy or instructor approval.

Rebuild source packs from their authored CSV/JSON/JSONL files with Python 3:

```bash
python3 scripts/rebuild-content.py
```

The practical archive contains its authoring inputs and offline builder. The rebuild keeps all three archives, Markdown study copies, and source-pack hash manifests in sync.

An optional browser check requires Chromium:

```bash
CHROMIUM_PATH=/usr/bin/chromium node scripts/check-human-review-ui.mjs
```

It uses temporary study data and a temporary browser profile. For manual review, check question wording, explanations and references alongside desktop/mobile interactions, save/resume, exports, and light/dark layouts.

`npm run dev` starts Vite for frontend work; it does not start the API. Use the built site through the Node server for the complete study workflow.

## Contributing

Community review is welcome: report questionable material, suggest clearer explanations, improve accessibility, add original practice content, or strengthen tests. Explain the proposed change and include an authoritative reference where possible. Run the checks and build before opening a pull request.

Do not submit exam dumps, proprietary course text, credentials, personal progress, or private study packs. Keep issue reports minimal and suitable for a public repository.

## Review status

This first release has received model-assisted editorial review and automated grading, import, and interface checks. It has not been validated by a human instructor or by CompTIA. Review remains open: verify uncertain answers and report specific concerns through the content-review issue template.

Terminology is checked against the [published SY0-701 objectives](https://comptiacdn.azureedge.net/webcontent/docs/default-source/exam-objectives/comptia-security-sy0-701-exam-objectives-(6-0).pdf), with technical references included in the source packs. Acronyms can vary by context; some exercises explicitly accept both exam-list and technical wording.

## License

[MIT](LICENSE) for this repository's code and original study content. Referenced third-party documents retain their own terms. Security+ and CompTIA are trademarks of their respective owners.
