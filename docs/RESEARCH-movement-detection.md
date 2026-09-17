# Movement detection: hand-tuned thresholds vs. learned classifiers

2026-09-16. Research only; nothing here is implemented. Decision pending (Jorge).

## TL;DR

**Our threshold approach is fine. What it lacks is real recorded data to tune against.** Nothing in this repo has ever been tuned on a real boxing movement: `fixtures/` doesn't exist yet, and `gestureConfig.fists` is still marked UNTUNED (synthetic only). A learned classifier needs the *same* recordings as input, plus labels. So the recordings come first either way. After that, the one addition worth piloting is **Google's k-NN pose classifier for the static poses (guard, duck, lean)**. Punches should keep the velocity trigger.

Performance (item 1) doesn't change this, with one exception:
- **On a working GPU,** pose-fps is not what breaks detection. At ≥ 20 pose-fps every synthetic punch that reaches half extension fires; losses start at ≤ 15 fps, and only for 60–90 ms snaps (`tmp/perf/punch-sampling.json`, `tests/tools/punch-sampling.tool.ts`).
- **In a browser rendering WebGL in software (WARP),** pose-fps drops to 2–5 and *no* detector can work. That was the likely state of Jorge's Chrome during the slow sessions (see PROGRESS). Every option below assumes a working GPU.

## What we have

Per gesture: landmarks → One Euro filter → signals normalized by torso and shoulder width → thresholds with hysteresis, hold times and cooldowns. Punch = wrist speed relative to the nose above `speed`, after the fist has been re-armed near the face.
- **Strengths:** deterministic, explainable, about 0 ms of compute, and each constant has a physical unit, so a playtest note maps to one number.
- **Weakness:** each constant was guessed from synthetic poses. People differ in stance, reach and speed, and there is no ground truth to check against.

## Options

### A. Tune the thresholds on recordings (already built)

- **What:** Jorge records the 14 drills (protocol in PROGRESS "Pose mirroring"). Then `pnpm tune:boxing` and `GRID=1` rank 1080 `fists` sets by count error against the known punch counts.
- **Cost:** about 1 h of recording plus about 1 h to apply and verify. No runtime cost.
- **Limits:**
  - One global set of constants for every body.
  - It can't tell a hook from an uppercut beyond `aim`.
  - Guard, duck and lean stay as hand-picked cutoffs.

### B. Pose embedding + k-NN for static poses (Google's pose classification)

Sources: [MediaPipe pose classification](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose_classification.md), [ML Kit guide](https://developers.google.com/ml-kit/vision/pose-detection/classifying-poses), ML Kit reference code ([PoseEmbedding](https://github.com/googlesamples/mlkit/blob/master/android/vision-quickstart/app/src/main/java/com/google/mlkit/vision/demo/java/posedetector/classification/PoseEmbedding.java), [PoseClassifier](https://github.com/googlesamples/mlkit/blob/master/android/vision-quickstart/app/src/main/java/com/google/mlkit/vision/demo/java/posedetector/classification/PoseClassifier.java), [EMASmoothing](https://github.com/googlesamples/mlkit/blob/master/android/vision-quickstart/app/src/main/java/com/google/mlkit/vision/demo/java/posedetector/classification/EMASmoothing.java), [RepetitionCounter](https://github.com/googlesamples/mlkit/blob/master/android/vision-quickstart/app/src/main/java/com/google/mlkit/vision/demo/java/posedetector/classification/RepetitionCounter.java)).

**How it works:**
- **Embedding:** center the pose on the hips and scale it by `max(torso × 2.5, max joint distance)`. The features are 22 pairwise joint distances (one joint apart, two apart, four and five apart, and across the body).
- **Classification:** two passes of k-NN.
  - Pass 1 keeps the top 30 samples by *max* per-axis distance, which rejects outliers.
  - Pass 2 keeps the top 10 by *mean* distance.
  - The z axis is weighted 0.2, and each query is also compared as its mirror image.
  - The score is the vote count out of 10.
- **Smoothing and events:** EMA smoothing (window 10, α 0.2), then enter at 6 votes and exit at 4.
- **Data:** about 100 samples per class per the ML Kit guide, a few hundred per the MediaPipe docs.

**Fit for us:**
- **Guard, duck and lean are single-frame poses,** exactly what this classifier is for. It replaces 3–5 hand-set cutoffs per pose with examples.
- **It adapts per person if we want:** a 5 s "show me your guard / duck" step at calibration could add personal samples. Kinect's Visual Gesture Builder used the same idea: per-frame classifier, windowed vote, threshold. ([AdaBoostTrigger](https://learn.microsoft.com/en-us/previous-versions/windows/kinect/dn785522(v=ieb.10)))
- **It is still deterministic and pure TS,** so it fits `src/core` or `src/pose` with no dependency and stays fixture-testable.
- **Weaknesses:**
  - Poses that aren't in the training set (sitting, a second person drifting in) vote for the nearest class. It needs an explicit "neutral / other" class.
  - The EMA adds about 3–5 frames of lag (≈ 100–150 ms at 30 fps). Duck is latency-sensitive: today it is a 100 ms hold, so the pilot must compare lag against it.
  - Lean is continuous, and the mirroring pose already uses the continuous value. k-NN would only produce the event.

**No official JS port.** A TS port is about 150 lines. Runtime: 22 features × ~300 samples × 2 (mirror) ≈ 13k float ops per frame, far below 0.1 ms.

**Cost:**
- About 1 day: port, a `tune`-style tool to build the sample set from recordings, fixture tests, and a side-by-side comparison against thresholds.
- Data: about 100 labelled frames per class. They can be cut from the drills (`guard.json`, `duck.json`, `sway.json`, `idle-stance.json`) by time range.
- **Perf cost: negligible.**

### C. Sequence models for punches (dynamic gestures)

A punch is a 150–400 ms sequence, not a pose.

**Options:**
- **1-NN DTW (dynamic time warping) over wrist/elbow trajectories:**
  - A few templates per class; about 1 ms per window in TS.
  - Jackknife ([repo](https://github.com/ISUE/Jackknife)) shows DTW with 1–2 samples per gesture works on Kinect skeletons, **but its code is academic-use only**, so it would have to be written from scratch.
- **Tiny GRU or 1D-CNN over a 15–18-frame landmark window:**
  - Size: about 20–50k parameters, under 1 ms per window on CPU (estimate).
  - DeepGRU ([arXiv 1810.12514](https://arxiv.org/abs/1810.12514)) reports competitive accuracy with few samples per class.
  - Data: a few hundred labelled punches.
  - Runtime: [LiteRT.js](https://developers.google.com/edge/litert/web/get_started) (WASM/WebGPU, launched 2026-07), TF.js or ONNX Runtime Web, which is **a new runtime dependency and needs an ADR**, or a hand-written forward pass.
- **ST-GCN / MS-G3D / PoseC3D:**
  - Heavy: ST-GCN is 3.1M parameters, PoseC3D is 33.6M parameters and 45 GFLOPs.
  - Built for 60+ classes on NTU, a large lab action dataset, with thousands of clips. **Overkill; rejected.**
- **Evidence ceiling:** wrist IMUs at 200 Hz on elite boxers classify jab/hook/uppercut at 92–95 % ([PLOS One 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12061147/)). A 30 fps 2D webcam skeleton of an amateur will do worse.

**The latency problem:**
- A classifier needs the gesture's shape. A window-based model decides at or after peak extension, about **100–200 ms later than the velocity trigger**, which fires on the way out.
- For a Wii-style boxing game, the hit must land when the fist lands.
- So a sequence model could only **label** a punch that the trigger has already fired (hook / uppercut / straight for damage or animation). It must not **gate** the punch.
- Our sim only needs `aim` today, so this solves a problem we don't have yet.

**Cost:** DTW is 1–2 days plus labelled templates. GRU is 3–5 days plus a few hundred labels plus an ADR. Compute is negligible next to 10–25 ms of pose inference, but the added detection latency is real.

### D. Other MediaPipe tasks

- **Gesture Recognizer** ([guide](https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer)):
  - **Hands only, one frame at a time.** Fist / open palm / thumbs etc.; custom gestures need Model Maker, which is [no longer actively maintained](https://developers.google.com/edge/mediapipe/solutions/model_maker).
  - Not applicable to body input.
  - Hands at 2.5 m are about 40 px, so even fist detection for guard would be unreliable.
- **Holistic Landmarker** ([guide](https://developers.google.com/edge/mediapipe/solutions/vision/holistic_landmarker)):
  - Pose + 478 face points + 2 hands.
  - Several times the cost of pose alone, and its web bundle has open issues ([#5508](https://github.com/google-ai-edge/mediapipe/issues/5508)).
  - With 2P already at 25 ms of inference against a 33 ms camera interval, **not affordable**, and it adds nothing for body gestures.
- **Nothing in MediaPipe classifies actions over time.** Pose classification (option B) is the only "above landmarks" tool Google ships, and it's single-frame.

## Performance budget check

These numbers are from item 1 (RTX 4060 laptop, fake camera, 1080p):

| | 1P | 2P |
| --- | --- | --- |
| Pose inference p50 | 11–15 ms | 23–29 ms |
| Camera interval | 33 ms | 33 ms |
| Headroom | ≈ 18 ms | ≈ 5–10 ms |

- B and C cost well under 1 ms per frame on the main thread, so they fit even in 2P.
- What is *not* affordable is anything that adds a second vision model per frame (Holistic, Hand Landmarker for fists).

## Recommendation

1. **Now:** record the drills and run `pnpm tune:boxing` + `GRID=1`. It is the cheapest option, already built, and every other option needs these recordings anyway. **Cost:** about 2 h of Jorge's time + about 2 h of agent time.
2. **If guard/duck/lean are still fragile across people after tuning:** pilot B for those three only.
   - Build it behind `gestureConfig` as `mode: 'threshold' | 'knn'`, with a fixture test comparing both on the drills (event counts and onset lag).
   - **Adopt it only if count error drops and duck lag stays within +50 ms.** Cost: about 1 day, no dependency, no runtime cost.
3. **Don't build C now.** Revisit only if the game design needs punch *types* (e.g. uppercut damage). Then use DTW labels on top of the existing trigger; move to a tiny GRU (with an ADR) only once there are a few hundred labelled punches.
4. **Skip D.**
