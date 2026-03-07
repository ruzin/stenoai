// ── AudioVisualizer ──
// Drives .waveform-bar heights from live audio input.
// Mic-only mode: opens its own getUserMedia stream for visualization only
// (Python backend records independently via sounddevice).
// System audio mode: reuses the existing AudioContext analyser.
window.AudioVisualizer = {
    _animFrame: null,
    _stream: null,
    _ctx: null,
    _lastFrame: 0,
    _abort: null,

    // Open a new mic stream purely for visualization.
    async start(bars) {
        this.stop();
        this._abort = new AbortController();
        const { signal } = this._abort;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            // stop() may have been called while getUserMedia was pending
            if (signal.aborted) {
                stream.getTracks().forEach(t => t.stop());
                return;
            }
            this._stream = stream;
            this._ctx = new AudioContext();
            await this._ctx.resume();
            const analyser = this._ctx.createAnalyser();
            analyser.fftSize = 256;
            this._ctx.createMediaStreamSource(this._stream).connect(analyser);
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            this._loop(bars, analyser, dataArray);
        } catch (e) {
            log(`Visualizer start error: ${e.message}`);
        }
    },

    // Use a pre-created AnalyserNode (system audio mode — no extra stream needed).
    startFromAnalyser(bars, analyser) {
        if (this._animFrame) cancelAnimationFrame(this._animFrame);
        this._animFrame = null;
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        this._loop(bars, analyser, dataArray);
    },

    stop() {
        if (this._abort) this._abort.abort();
        if (this._animFrame) {
            cancelAnimationFrame(this._animFrame);
            this._animFrame = null;
        }
        if (this._ctx) {
            this._ctx.close();
            this._ctx = null;
        }
        if (this._stream) {
            this._stream.getTracks().forEach(t => t.stop());
            this._stream = null;
        }
    },

    _loop(bars, analyser, dataArray) {
        // Throttle DOM writes to ~20fps — rAF still drives the loop so it
        // pauses automatically when the window is hidden.
        const now = performance.now();
        if (now - this._lastFrame >= 50) {
            this._lastFrame = now;
            analyser.getByteFrequencyData(dataArray);
            // fftSize=256 → 128 bins at ~187.5 Hz/bin (48 kHz)
            // 8 log-spaced octave bands across the speech range (~0-12000 Hz)
            const binGroups = [
                [0],
                [1, 2],
                [3, 4],
                [5, 6, 7, 8],
                [9, 10, 11, 12, 13, 14, 15, 16, 17],
                [18, 19, 20, 21, 22, 23, 24, 25, 26,
                 27, 28, 29, 30, 31, 32, 33, 34],
                [35, 36, 37, 38, 39, 40, 41, 42],
                [43, 44, 45, 46, 47, 48, 49, 50, 51,
                 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63]
            ];
            bars.forEach((bar, i) => {
                const group = binGroups[i];
                const avg = group.reduce((sum, b) => sum + (dataArray[b] || 0), 0) / group.length;
                bar.style.height = `${Math.max(4, Math.round(4 + (avg / 255) * 16))}px`;
            });
        }
        this._animFrame = requestAnimationFrame(() => this._loop(bars, analyser, dataArray));
    }
};
