# Speech workspace

Primary target: `src/renderer/App.jsx`

Related targets: `src/renderer/Synthesis.jsx`, `src/renderer/Transcription.jsx`, `src/renderer/Library.jsx`, `src/renderer/TaskPanel.jsx`, `src/renderer/Settings.jsx`, `src/renderer/styles.css`

## Scope and visitor mode

Mode: **Operate**. This Electron + React surface serves a person working with local speech models on Windows. The current scope covers speech synthesis, audio transcription, the actual voice library, task records, and runtime settings. PDF and OCR are outside this UI release.

Success means preparing usable input, starting a local task, understanding its state, auditioning or reading the output, and saving or reusing it. Model loading and inference stay behind the desktop bridge; browsing the interface and voice library does not itself start inference.

## Direction contract

**THESIS:** A desktop speech workspace keeps preparation and result handling adjacent. Functional task navigation and explicit state messages carry the workflow; expression comes from auditioning real speech and editing complete voice descriptions.

**OWN-WORLD:** A pale sage sidebar, white editor panels, deep green actions, restrained borders, Windows system typography, native text/select/audio controls, and the radius scale documented in DESIGN.md form the implemented visual language.

**STORY:** The user enters text or chooses audio, submits a task, follows its state, then listens, reads, exports, or reuses a voice description. Failed and interrupted tasks retain an explanation and can be revisited from history.

**FIRST VIEWPORT:** Desktop task navigation sits at the left, followed by a compact environment bar and task heading. The large preparation panel occupies the main column; task and result handling occupies the narrower right column. The primary submit action sits at the preparation panel footer. Narrow windows stack preparation and results.

**FORM:** The seed script returned key `c565aced` and label `assigned5 operate`; this output was not an independently approved visual form. The final direction was inferred during direct implementation from the user's Electron + React choice and clear speech-only scope, retaining functional density and native task controls. No user-approved visual direction, raster comp, or artwork was obtained. The source is the composition evidence.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Core workflows and content

- **Synthesis:** Select the language, enter the script, choose a starting preset or reuse an existing full voice prompt, optionally name the output, and generate. Text and the selected language should agree. Required empty fields keep submission disabled.
- **Transcription:** Choose supported local audio or record up to five minutes. Preview the input and start recognition. The result panel offers a readable transcript, copy, export, and output-file access.
- **Voice library:** Search actual names, categories, or prompt text; filter categories; select a record; listen to its audio; inspect its complete prompt and sample text; reuse its prompt and language in synthesis.
- **Task records:** Filter task types, inspect current or past state, review logs, revisit output, and re-run a finished task.
- **Environment settings:** Configure separate TTS and ASR Python environments, local model paths, output location, and GPU settings; explicitly request environment checks and read their evidence.

## Signature interaction

Audition → inspect the complete prompt → reuse it in the editor. The library reuse action switches to synthesis, inserts the complete stored prompt, and carries its language. The editor keeps the prompt editable. This is VoiceDesign prompt reuse; repeated inference may vary the resulting voice.

## States and interaction constraints

The task panel exposes waiting, running, completed, failed, cancelled, and interrupted states. Waiting and running tasks offer cancellation. Completed synthesis exposes a playable WAV with sample rate and duration; completed transcription exposes text and warnings when present. Error details retain specific reasons. Logs are available on demand.

GPU work is serialized, with queue information near the task workflow. Long model loading is acknowledged at submission. Browser preview explicitly indicates its limited mode; desktop-only controls are disabled until the bridge exists. Microphone permission failure offers an actionable message and file import remains available.

Keep source voice-library records and user audio read-only. Exports and task outputs use their dedicated locations. UI documentation must not claim model inference, microphone recording, language quality, or prompt fidelity was validated unless corresponding runtime evidence exists.

## Responsive and accessibility acceptance

The desktop uses task navigation plus adjacent preparation/result columns. Below the stacking breakpoint, results follow preparation. The narrowest CSS layout uses horizontal task navigation and single-column fields. Exact widths and breakpoints are owned by DESIGN.md and its sidecar.

Every input and icon-only action needs a useful accessible name. Navigation retains readable labels and an active-page indicator. Audio controls remain native. Focus treatments and disabled states must stay visible. Task notices use status semantics, errors use alert semantics, and reduced-motion preferences remove animation. The final review darkened supporting text, placeholders, and descriptions while preserving action colors and distinct borders. Runtime smoke checks audit computed foreground/background pairs for each screen; color values remain owned by DESIGN.md.

## Review evidence and open decisions

The root implementation review owns screenshots, workflow checks, and the final verdict. DESIGN.md and `.impeccable/design.json` document the extracted CSS and component behavior; they do not substitute for runtime testing. No raster assets ship from this UI implementation, so artwork provenance is not applicable.

No user-confirmed brand story or visual identity asset exists. The current design direction describes the implemented local workspace. Future scope expansions should preserve these established task conventions and update the surface brief when the workflow changes.

## Voice sample selection

Selecting a synthesis preset, a library dropdown option, or a voice-library row plays the existing indexed WAV after the explicit selection. Preset samples are mapped to emotion_healing, movie_narrator_male, and knowledge_professional_female; selecting one uses that recording's full prompt and keeps the typed text and synthesis language. Dropdown reuse retains its existing language synchronization. The inline sample area shows source name, language, text and native pause/seek controls, with a replay action. No sample starts on first launch, no model is loaded for audition, stale asynchronous responses cannot replace the latest choice, and playback stops on selection change or page exit. Edited prompts clear the sample association. Generated voice designs may differ from the recorded example.

