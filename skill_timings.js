(function () {

    // ── Constants ─────────────────────────────────────────────────────────────
    var ID = 'skill_timings';

    // Colors matching SkillPhaseDebugHud
    var COL = {
        windup:   { fill: 'rgba(51,102,255,.20)',  border: '#3366FF', label: '#6699FF' },
        action:   { fill: 'rgba(255,68,68,.20)',   border: '#FF4444', label: '#FF8888' },
        recovery: { fill: 'rgba(255,204,0,.18)',   border: '#FFCC00', label: '#FFE566' },
        marker:   '#44FF44',
    };

    // ── Helpers ───────────────────────────────────────────────────────────────
    function toSec(tk)  { return tk / 20; }
    function toTick(s)  { return Math.round(s * 20); }

    function hasData(anim) {
        return anim && anim[ID + '_init'] === true;
    }

    function initData(anim) {
        if (!anim) return null;
        var total = toTick(anim.length || 1);
        anim[ID + '_init']       = true;
        anim[ID + '_windup_end'] = Math.round(total * 0.25);
        anim[ID + '_active_end'] = Math.round(total * 0.65);
        anim[ID + '_skip_windup']= 0;
        return getData(anim);
    }

    function getData(anim) {
        if (!anim) return null;
        return {
            get windup_end()        { return anim[ID + '_windup_end']  || 0; },
            set windup_end(v)       { anim[ID + '_windup_end']  = v; },
            get active_end()        { return anim[ID + '_active_end']  || 0; },
            set active_end(v)       { anim[ID + '_active_end']  = v; },
            get total_end()         { return toTick(anim.length || 1); },
            set total_end(v)        { /* locked to anim.length */ },
            get skip_windup_ticks() { return anim[ID + '_skip_windup'] || 0; },
            set skip_windup_ticks(v){ anim[ID + '_skip_windup'] = v; },
        };
    }

    function clamp(d, animTicks) {
        var total = animTicks || 1;
        d.total_end         = total;
        d.windup_end        = Math.max(0, Math.min(d.windup_end, total));
        d.active_end        = Math.max(d.windup_end, Math.min(d.active_end, total));
        d.skip_windup_ticks = Math.max(0, d.skip_windup_ticks);
    }

    // Persisted mod ID — used as namespace prefix for animation IDs.
    var currentModId = localStorage.getItem('skt_modid')
        || (typeof Project !== 'undefined' && Project && Project.namespace)
        || 'leklai';

    // Resolve the namespaced animation ID for data export.
    // Uses the animation name if it already contains ':', otherwise prepends
    // currentModId (set by the panel's Mod ID field).
    function resolveAnimId(anim) {
        var name = anim.name || '';
        if (name.includes(':')) return name;
        return currentModId + ':' + name;
    }

    // ── Instruction color (hash name → hsl) ─────────────────────────────────
    function instrColorHash(label) {
        label = (label || '').replace(/;\s*$/, '').trim();
        var hash = 0;
        for (var i = 0; i < label.length; i++) {
            hash = label.charCodeAt(i) + ((hash << 5) - hash);
        }
        return 'hsl(' + (Math.abs(hash) % 360) + ',80%,62%)';
    }

    // Returns instruction keyframes from the effects channel, sorted by time.
    function getInstructionKFs(anim) {
        if (!anim || !anim.animators.effects || !anim.animators.effects.keyframes) return [];
        return anim.animators.effects.keyframes
            .filter(function(kf) { return kf.channel === 'timeline'; })
            .sort(function(a, b) { return a.time - b.time; });
    }

    // ── GeckoLib Instructions keyframe ────────────────────────────────────────
    function addInstructionKF(anim, ticks, instruction) {
        if (!anim) return;
        if (!anim.animators.effects)
            anim.animators.effects = new EffectAnimator(anim);
        Undo.initEdit({ keyframes: [] });
        anim.animators.effects.addKeyframe({
            channel:     'timeline',
            time:        toSec(ticks),
            data_points: [{ script: instruction.replace(/;\s*$/, '').trim() }],
        });
        Undo.finishEdit('Add instruction: ' + instruction);
        if (Timeline.vue) Timeline.vue.$forceUpdate();
    }

    // ── Timeline overlay ──────────────────────────────────────────────────────
    var overlayEl  = null;
    var rafQueued  = false;

    function getTLContainer() {
        return document.querySelector('#timeline .tl_tracks')
            || document.querySelector('#timeline .tl_body')
            || document.querySelector('#timeline .timeline_body')
            || document.querySelector('#timeline > div:last-child')
            || document.querySelector('#timeline');
    }

    function getOrCreateOverlay() {
        var tl = getTLContainer();
        if (!tl) return null;
        if (overlayEl && tl.contains(overlayEl)) return overlayEl;
        if (overlayEl) overlayEl.remove();
        overlayEl = document.createElement('div');
        overlayEl.id = 'skt-overlay';
        overlayEl.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:5;overflow:visible;';
        tl.style.position = 'relative';
        tl.appendChild(overlayEl);
        return overlayEl;
    }

    function removeOverlay() {
        if (overlayEl) overlayEl.remove();
        overlayEl = null;
    }

    function secToX(sec) {
        var tl   = getTLContainer();
        var zoom = Timeline.zoom || 1;
        return sec * 200 * zoom - (tl ? tl.scrollLeft : 0);
    }

    function drawOverlay() {
        var ov = getOrCreateOverlay();
        if (!ov) return;
        ov.innerHTML = '';

        var anim = Animation.selected;
        if (!anim) return;
        var d = getData(anim);
        var h = (getTLContainer() || {clientHeight: 300}).clientHeight || 300;

        function bar(xLeft, xRight, col, labelText) {
            var w = xRight - xLeft;
            if (w < 1) return;
            var el = document.createElement('div');
            el.style.cssText = 'position:absolute;top:0;'
                + 'left:' + Math.max(0, xLeft) + 'px;'
                + 'width:' + Math.max(0, w) + 'px;'
                + 'height:' + h + 'px;'
                + 'background:' + col.fill + ';'
                + 'border-right:2px solid ' + col.border + ';'
                + 'box-sizing:border-box;';
            var lbl = document.createElement('div');
            lbl.textContent = labelText;
            lbl.style.cssText = 'position:absolute;top:2px;left:3px;'
                + 'font-size:9px;font-family:monospace;font-weight:bold;'
                + 'letter-spacing:.07em;text-transform:uppercase;'
                + 'color:' + col.label + ';pointer-events:none;white-space:nowrap;';
            el.appendChild(lbl);
            ov.appendChild(el);
        }

        var x0 = secToX(0);
        var xW = secToX(toSec(d.windup_end));
        var xA = secToX(toSec(d.active_end));
        var xT = secToX(toSec(d.total_end));

        bar(x0, xW, COL.windup,   'W ' + d.windup_end + 'tk');
        bar(xW, xA, COL.action,   'A ' + d.active_end + 'tk');
        bar(xA, xT, COL.recovery, 'R ' + d.total_end  + 'tk');

        getInstructionKFs(anim).forEach(function(kf) {
            var x   = secToX(kf.time);
            var txt = (kf.data_points && kf.data_points[0]) ? kf.data_points[0].script || '' : '';
            var col = instrColorHash(txt);

            var line = document.createElement('div');
            line.style.cssText = 'position:absolute;top:0;left:' + x + 'px;'
                + 'width:1px;height:' + h + 'px;background:' + col + ';opacity:.5;';
            ov.appendChild(line);

            var diamond = document.createElement('div');
            diamond.style.cssText = 'position:absolute;top:4px;'
                + 'left:' + (x - 5) + 'px;'
                + 'width:10px;height:10px;'
                + 'background:' + col + ';transform:rotate(45deg);';
            ov.appendChild(diamond);

            if (txt) {
                var lbl = document.createElement('div');
                lbl.textContent = txt;
                lbl.style.cssText = 'position:absolute;top:2px;left:' + (x + 8) + 'px;'
                    + 'font-size:9px;font-family:monospace;color:' + col + ';'
                    + 'font-weight:bold;white-space:nowrap;pointer-events:none;'
                    + 'text-shadow:0 1px 3px rgba(0,0,0,.8);';
                ov.appendChild(lbl);
            }
        });
    }

    function queueDraw() {
        if (rafQueued) return;
        rafQueued = true;
        requestAnimationFrame(function() { rafQueued = false; drawOverlay(); });
    }

    // ── Panel (docked sidebar) ────────────────────────────────────────────────
    var sktPanel = null;

    function buildPanel() {
        sktPanel = new Panel(ID + '_panel', {
            id:           ID + '_panel',
            name:         'Skill Timeline',
            icon:         'sports_score',
            resizable:    true,
            growable:     false,
            condition:    { modes: ['animate'] },

            component: {
                data: function() {
                    return {
                        windup_end:        5,
                        active_end:        13,
                        total_end:         20,
                        skip_windup_ticks: 0,
                        animName:          '',
                        animTicks:         0,
                        newInstr:          '',
                        phTick:            0,
                        status:            '',
                        instrTicks:        [],
                        initialized:       false,
                        _ticker:           null,
                        modId: localStorage.getItem('skt_modid')
                            || (typeof Project !== 'undefined' && Project && Project.namespace)
                            || 'leklai',
                    };
                },

                computed: {
                    maxTick: function() { return Math.max(this.total_end, 1); },
                    wPct:    function() { return Math.min(100, this.windup_end  / this.maxTick * 100).toFixed(1); },
                    aPct:    function() { return Math.min(100, this.active_end  / this.maxTick * 100).toFixed(1); },
                    rPct:    function() { return Math.min(100, this.total_end   / this.maxTick * 100).toFixed(1); },
                    skipSec: function() { return toSec(this.skip_windup_ticks).toFixed(2); },
                    instrPcts: function() {
                        var denom = Math.max(this.animTicks, this.maxTick, 1);
                        return this.instrTicks.map(function(it) {
                            return { pct: Math.min(100, it.tick / denom * 100).toFixed(2), label: it.label };
                        });
                    },
                    skipPct: function() {
                        return Math.min(100, this.skip_windup_ticks / this.maxTick * 100).toFixed(2);
                    },
                    activePhase: function() {
                        var t = this.phTick;
                        if (t <= 0)                  return 'none';
                        if (t <= this.windup_end)    return 'windup';
                        if (t <= this.active_end)    return 'action';
                        if (t <= this.total_end)     return 'recovery';
                        return 'none';
                    },
                    currentPct: function() {
                        var denom = Math.max(this.animTicks, this.maxTick, 1);
                        return Math.min(100, this.phTick / denom * 100);
                    },
                    wPctA: function() {
                        var denom = Math.max(this.animTicks, this.maxTick, 1);
                        return Math.min(100, this.windup_end / denom * 100);
                    },
                    aPctA: function() {
                        var denom = Math.max(this.animTicks, this.maxTick, 1);
                        return Math.min(100, this.active_end / denom * 100);
                    },
                    rPctA: function() {
                        var denom = Math.max(this.animTicks, this.maxTick, 1);
                        return Math.min(100, this.total_end / denom * 100);
                    },
                    // True when this animation has instruction keyframes but no skill timing data.
                    // Server cannot schedule these instructions until timing data is added.
                    hasInstrWithoutData: function() {
                        var anim = Animation.selected;
                        if (!anim || hasData(anim)) return false;
                        return getInstructionKFs(anim).length > 0;
                    },
                    // Mirrors the default filename used by doExport — shown in the path hint.
                    exportFileName: function() {
                        return (typeof Project !== 'undefined' && Project && Project.name)
                            ? Project.name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()
                            : 'skill_timing_set';
                    },
                    // All animations in the project that have instruction keyframes
                    // but no skill timing data — used in the project-wide warning footer.
                    uninitWithInstrs: function() {
                        var names = [];
                        Animation.all.forEach(function(anim) {
                            if (hasData(anim)) return;
                            if (getInstructionKFs(anim).length > 0) names.push(anim.name);
                        });
                        return names;
                    },
                },

                methods: {
                    load: function() {
                        var anim = Animation.selected;
                        this.animName  = anim ? anim.name : '—';
                        var animTks = anim ? toTick(anim.length || 0) : 0;
                        this.animTicks = animTks;
                        this.initialized = anim ? hasData(anim) : false;
                        if (!anim || !this.initialized) return;
                        var d = getData(anim);
                        this.windup_end        = d.windup_end;
                        this.active_end        = d.active_end;
                        this.total_end         = animTks;
                        this.skip_windup_ticks = d.skip_windup_ticks;
                        var instrs = [];
                        getInstructionKFs(anim).forEach(function(kf) {
                            instrs.push({
                                tick:  toTick(kf.time),
                                label: kf.data_points && kf.data_points[0] ? kf.data_points[0].script || '' : '',
                            });
                        });
                        this.instrTicks = instrs;
                    },
                    save: function() {
                        var anim = Animation.selected;
                        if (!anim || !hasData(anim)) return;
                        var d = getData(anim);
                        d.windup_end        = this.windup_end;
                        d.active_end        = this.active_end;
                        d.total_end         = this.total_end;
                        d.skip_windup_ticks = this.skip_windup_ticks;
                        clamp(d, this.animTicks);
                        this.windup_end        = d.windup_end;
                        this.active_end        = d.active_end;
                        this.total_end         = d.total_end;
                        this.skip_windup_ticks = d.skip_windup_ticks;
                        queueDraw();
                    },
                    initSkill: function() {
                        var anim = Animation.selected;
                        if (!anim) return;
                        initData(anim);
                        this.load();
                        queueDraw();
                        this.flash('Skill data initialized for "' + anim.name + '"');
                    },
                    removeSkill: function() {
                        var anim = Animation.selected;
                        if (!anim) return;
                        anim[ID + '_init']        = false;
                        anim[ID + '_windup_end']  = 0;
                        anim[ID + '_active_end']  = 0;
                        anim[ID + '_skip_windup'] = 0;
                        this.initialized = false;
                        removeOverlay();
                        this.flash('Skill data removed');
                    },
                    insert: function() {
                        var instr = (this.newInstr || '').trim();
                        if (!instr) return;
                        var anim = Animation.selected;
                        if (!anim) { Blockbench.showMessage('Select an animation first.', 'center'); return; }
                        addInstructionKF(anim, this.phTick, instr);
                        this.flash('Added "' + instr + '" at ' + this.phTick + 'tk');
                        this.newInstr = '';
                        this.load();
                        queueDraw();
                    },

                    instrColor: function(label) {
                        return instrColorHash(label);
                    },

                    seekTo: function(tick) {
                        Timeline.time = toSec(tick);
                        if (Timeline.vue) Timeline.vue.$forceUpdate();
                    },

                    renameInstr: function(index) {
                        var self = this;
                        var anim = Animation.selected;
                        if (!anim || !anim.animators.effects) return;
                        var kfs = getInstructionKFs(anim);
                        var kf = kfs[index];
                        if (!kf) return;
                        var current = (kf.data_points && kf.data_points[0] ? kf.data_points[0].script || '' : '').replace(/;\s*$/, '').trim();
                        var dialog = new Dialog({
                            id: 'skt_rename',
                            title: 'Rename Instruction',
                            form: {
                                name: { label: 'Instruction', type: 'text', value: current },
                            },
                            onConfirm: function(form) {
                                var newName = (form.name || '').replace(/;\s*$/, '').trim();
                                if (!newName) return;
                                Undo.initEdit({ keyframes: [kf] });
                                if (kf.data_points && kf.data_points[0]) kf.data_points[0].script = newName;
                                Undo.finishEdit('Rename instruction');
                                self.load();
                                queueDraw();
                                self.flash('Renamed to "' + newName + '"');
                            },
                        });
                        dialog.show();
                    },

                    deleteInstr: function(index) {
                        var self = this;
                        var anim = Animation.selected;
                        if (!anim || !anim.animators.effects) return;
                        var kfs = getInstructionKFs(anim);
                        var kf = kfs[index];
                        if (!kf) return;
                        Undo.initEdit({ keyframes: [kf] });
                        kf.remove();
                        Undo.finishEdit('Delete instruction');
                        self.load();
                        queueDraw();
                    },

                    // Export ALL initialized animations in the new skill_animation_timing_sets format.
                    // This is the data file that goes into data/<ns>/leklai/skill_animation_timing_sets/.
                    // The animation JSON is NOT modified — skill block injection is removed.
                    doExport: function() {
                        var self = this;
                        var animations = {};
                        var skipped = [];
                        Animation.all.forEach(function(anim) {
                            if (!hasData(anim)) return;
                            var d = getData(anim);
                            var animId = resolveAnimId(anim);
                            var totalTk = toTick(anim.length || 0);
                            var entry = { animation_length_ticks: totalTk };
                            if (d.windup_end > 0 || d.active_end > 0) {
                                entry.timings = {
                                    windup_end: d.windup_end,
                                    active_end: d.active_end,
                                    total_end:  totalTk,
                                };
                            }
                            if (d.skip_windup_ticks > 0) entry.skip_windup_ticks = d.skip_windup_ticks;
                            var instrs = [];
                            getInstructionKFs(anim).forEach(function(kf) {
                                var name = (kf.data_points && kf.data_points[0])
                                           ? (kf.data_points[0].script || '').replace(/;\s*$/, '').trim() : '';
                                if (name) instrs.push({ tick: toTick(kf.time), name: name });
                            });
                            if (instrs.length > 0) entry.instructions = instrs;
                            animations[animId] = entry;
                        });

                        if (Object.keys(animations).length === 0) {
                            Blockbench.showMessage('No initialized skill animations found in this project.', 'center');
                            return;
                        }

                        Blockbench.export({
                            type: 'JSON', extensions: ['json'],
                            name: this.exportFileName,
                            content: JSON.stringify({ animations: animations }, null, 2),
                        });
                        self.flash('Exported ' + Object.keys(animations).length + ' animation(s)');
                    },

                    // Import: accepts both the old single-animation .skill format and the
                    // new skill_animation_timing_sets format (loads first matching animation).
                    doImport: function() {
                        var self = this;
                        Blockbench.import({ extensions: ['json'], type: 'Skill JSON' }, function(files) {
                            try {
                                var p = JSON.parse(files[0].content);
                                // New format: { animations: { "ns:path": { timings, ... } } }
                                var sk = null;
                                if (p.animations) {
                                    var anim = Animation.selected;
                                    if (anim) {
                                        var animId = resolveAnimId(anim);
                                        sk = p.animations[animId] || p.animations[anim.name];
                                        if (sk && sk.timings) sk = { timings: sk.timings, skip_windup_ticks: sk.skip_windup_ticks || 0 };
                                    }
                                } else {
                                    // Old single-animation format: { skill: { timings, skip_windup_ticks } }
                                    sk = p.skill || p;
                                }
                                if (!sk) { Blockbench.showMessage('Animation not found in file.', 'center'); return; }
                                var t = sk.timings || {};
                                var d = getData(Animation.selected);
                                if (!d) return;
                                if (t.windup_end        != null) d.windup_end        = t.windup_end;
                                if (t.active_end        != null) d.active_end        = t.active_end;
                                if (t.total_end         != null) d.total_end         = t.total_end;
                                if (sk.skip_windup_ticks != null) d.skip_windup_ticks = sk.skip_windup_ticks;
                                clamp(d, toTick((Animation.selected && Animation.selected.length) || 1));
                                self.load();
                                queueDraw();
                                self.flash('Imported!');
                            } catch(e) {
                                Blockbench.showMessage('Parse error: ' + e.message, 'center');
                            }
                        });
                    },

                    saveModId: function() {
                        var id = (this.modId || '').trim().replace(/[^a-zA-Z0-9_]/g, '') || 'leklai';
                        this.modId = id;
                        currentModId = id;
                        localStorage.setItem('skt_modid', id);
                    },

                    flash: function(msg) {
                        var self = this;
                        this.status = msg;
                        setTimeout(function() { self.status = ''; }, 2500);
                    },
                },

                mounted: function() {
                    var self = this;
                    this.load();

                    var lastTime = -1;
                    function tick() {
                        if (!self._rafAlive) return;
                        var t = Timeline.time || 0;
                        var tk = toTick(t);
                        if (tk !== lastTime) { lastTime = tk; self.phTick = tk; }
                        var aTks = toTick((Animation.selected && Animation.selected.length) || 0);
                        if (aTks !== self.animTicks && aTks > 0) {
                            self.animTicks = aTks;
                            self.total_end = aTks;
                            var dd = getData(Animation.selected);
                            if (dd) dd.total_end = aTks;
                        }
                        requestAnimationFrame(tick);
                    }
                    this._rafAlive = true;
                    requestAnimationFrame(tick);
                },

                beforeDestroy: function() {
                    this._rafAlive = false;
                },

                template: `
<div style="padding:0;font-family:'Segoe UI',system-ui,sans-serif;font-size:15px;color:#e0e0e0;overflow-y:auto;height:100%;background:#1c1c1c;">

  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px 8px;border-bottom:1px solid #3a3a3a;background:#242424;">
    <span style="font-size:15px;font-weight:600;color:#4a9eff;letter-spacing:.03em;">◈ Skill Timeline</span>
    <span style="font-size:12px;color:#777777;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
          :title="animName">{{ animName }}</span>
  </div>

  <!-- Anim info -->
  <div style="padding:4px 12px 5px;font-size:12px;color:#777777;border-bottom:1px solid #3a3a3a;">
    anim: {{ animTicks }}tk = {{ (animTicks/20).toFixed(2) }}s
  </div>

  <!-- ⚠ Warning: this animation has instructions but no skill timing data -->
  <div v-if="hasInstrWithoutData"
       style="margin:8px 12px;padding:8px 10px;background:#1a1200;border:1px solid #6a4800;border-radius:2px;">
    <div style="font-size:14px;color:#e8b84b;font-weight:600;margin-bottom:4px;">⚠ Missing timing data</div>
    <div style="font-size:12px;color:#8a6020;line-height:1.5;">
      This animation has instruction keyframes but skill timing is not initialized.
      The server will not schedule these instructions until you add timing data.
    </div>
    <button @click="initSkill"
      style="margin-top:7px;background:#120e00;border:1px solid #6a4800;color:#e8b84b;
             padding:5px 0;border-radius:2px;font-size:13px;cursor:pointer;width:100%;
             font-family:'Segoe UI',system-ui,sans-serif;"
      onmouseover="this.style.background='#221800'"
      onmouseout="this.style.background='#120e00'">
      + Initialize Skill Data
    </button>
  </div>

  <!-- Not initialized (and no warning already shown above) -->
  <div v-if="!initialized && !hasInstrWithoutData" style="text-align:center;padding:28px 12px;">
    <div style="font-size:12px;color:#777777;text-transform:uppercase;letter-spacing:.1em;margin-bottom:12px;">
      No skill data on this animation
    </div>
    <button @click="initSkill"
      style="background:#242424;border:1px solid #4a9eff;color:#4a9eff;
             padding:8px 0;border-radius:2px;font-size:14px;cursor:pointer;
             letter-spacing:.04em;display:block;width:100%;margin-bottom:6px;
             font-family:'Segoe UI',system-ui,sans-serif;"
      onmouseover="this.style.background='rgba(74,158,255,.1)'"
      onmouseout="this.style.background='#242424'">
      + Initialize Skill Data
    </button>
    <div style="font-size:12px;color:#555555;margin-top:5px;">
      Only animations that need skill timings should be initialized
    </div>
  </div>

  <!-- Initialized state -->
  <div v-if="initialized">

    <!-- Total End -->
    <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 12px;background:#242424;border-bottom:1px solid #3a3a3a;">
      <span style="font-size:12px;font-weight:600;color:#e8b84b;text-transform:uppercase;letter-spacing:.07em;">Total End</span>
      <div style="display:flex;align-items:baseline;gap:6px;">
        <span style="font-size:18px;font-weight:700;color:#e8b84b;">{{ total_end }}</span>
        <span style="font-size:12px;color:#777777;">tk</span>
        <span style="font-size:12px;color:#777777;">{{ (total_end/20).toFixed(2) }}s</span>
      </div>
    </div>

    <!-- Windup End / Active End -->
    <div v-for="ph in [{key:'windup_end',label:'Windup End',color:'#4a9eff',pct:wPct},
                       {key:'active_end',label:'Active End',color:'#e05555',pct:aPct}]"
         :key="ph.key" style="padding:6px 12px 2px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="display:flex;align-items:center;gap:7px;font-size:14px;">
          <span :style="{display:'inline-block',width:'9px',height:'9px',borderRadius:'50%',background:ph.color,flexShrink:0}"></span>
          <span :style="{color:ph.color}">{{ ph.label }}</span>
        </span>
        <div style="display:flex;align-items:center;gap:6px;">
          <input type="number" min="0"
            :value="$data[ph.key]"
            @change="$data[ph.key] = +$event.target.value; save()"
            style="width:62px;background:#303030;border:1px solid #4a4a4a;color:#e0e0e0;
                   padding:4px 7px;border-radius:2px;font-size:14px;text-align:right;
                   font-family:'Segoe UI',system-ui,sans-serif;outline:none;">
          <span style="font-size:12px;color:#777777;">tk</span>
          <span style="font-size:12px;color:#777777;">{{ (+$data[ph.key]/20).toFixed(2) }}s</span>
        </div>
      </div>
      <div style="height:4px;background:#303030;border-radius:1px;overflow:hidden;margin-bottom:4px;">
        <div :style="{height:'100%',borderRadius:'1px',transition:'width .1s',background:ph.color,width:ph.pct+'%'}"></div>
      </div>
    </div>

    <!-- Preview bar -->
    <div style="padding:8px 12px 10px;">
      <div style="font-size:12px;color:#777777;margin-bottom:6px;">Preview</div>
      <div style="position:relative;">

        <!-- Pin markers -->
        <div style="position:relative;height:14px;margin-bottom:2px;">
          <div v-for="(ip, i) in instrPcts" :key="i"
               :style="{position:'absolute',left:'calc('+ip.pct+'% - 3px)',top:0}"
               :title="ip.label + ' (' + instrTicks[i].tick + 'tk)'">
            <div :style="{width:'1px',height:'8px',background:instrColor(instrTicks[i].label),margin:'0 auto'}"></div>
            <div :style="{width:0,height:0,margin:'0 auto',
                          borderLeft:'3px solid transparent',borderRight:'3px solid transparent',
                          borderTop:'4px solid '+instrColor(instrTicks[i].label)}"></div>
          </div>
        </div>

        <!-- Timeline segments -->
        <div style="position:relative;height:16px;background:#303030;border-radius:2px;overflow:hidden;border:1px solid #3a3a3a;">
          <div :style="{position:'absolute',top:0,height:'100%',left:'0%',width:wPctA+'%',
                        background:activePhase==='windup'?'rgba(74,158,255,.55)':'rgba(74,158,255,.22)'}"></div>
          <div :style="{position:'absolute',top:0,height:'100%',left:wPctA+'%',width:(aPctA-wPctA)+'%',
                        background:activePhase==='action'?'rgba(224,85,85,.55)':'rgba(224,85,85,.22)'}"></div>
          <div :style="{position:'absolute',top:0,height:'100%',left:aPctA+'%',width:(rPctA-aPctA)+'%',
                        background:activePhase==='recovery'?'rgba(232,184,75,.50)':'rgba(232,184,75,.18)'}"></div>
          <div :style="{position:'absolute',top:0,height:'100%',left:rPctA+'%',width:(100-rPctA)+'%',
                        background:'rgba(255,255,255,.03)'}"></div>
          <div v-for="(ip, i) in instrPcts" :key="'l'+i"
               :style="{position:'absolute',top:0,left:ip.pct+'%',width:'1px',height:'100%',
                        background:instrColor(instrTicks[i].label),opacity:.75}"></div>
          <div :style="{position:'absolute',top:0,left:currentPct+'%',width:'2px',height:'100%',
                        background:'rgba(255,255,255,.8)',transform:'translateX(-1px)'}"></div>
        </div>

        <!-- Skip windup strip -->
        <div style="position:relative;height:4px;margin-top:3px;background:#303030;border-radius:1px;overflow:hidden;"
             :title="'Skip windup: '+skip_windup_ticks+'tk'">
          <div :style="{position:'absolute',top:0,left:0,height:'100%',width:skipPct+'%',
                        background:'rgba(74,158,255,.45)',
                        borderRight:skip_windup_ticks>0?'1px solid #4a9eff':'none'}"></div>
        </div>

        <div style="display:flex;justify-content:space-between;margin-top:4px;">
          <span style="font-size:12px;color:rgba(74,158,255,.7);">skip: {{ skip_windup_ticks }}tk</span>
          <span style="font-size:12px;color:#777777;">{{ instrPcts.length }} instr</span>
        </div>
      </div>
    </div>

    <div style="height:1px;background:#3a3a3a;margin:4px 0;"></div>

    <!-- Skip Windup -->
    <div style="padding:6px 12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
        <div>
          <span style="font-size:15px;color:#b0b0b0;">Skip Windup</span>
          <span style="font-size:12px;color:#777777;margin-left:5px;">on chain-in</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <input type="number" min="0" v-model.number="skip_windup_ticks" @change="save()"
            style="width:62px;background:#303030;border:1px solid #4a4a4a;color:#e0e0e0;
                   padding:4px 7px;border-radius:2px;font-size:14px;text-align:right;
                   font-family:'Segoe UI',system-ui,sans-serif;outline:none;">
          <span style="font-size:12px;color:#777777;">tk</span>
          <span style="font-size:12px;color:#777777;">{{ skipSec }}s</span>
        </div>
      </div>
      <div style="font-size:12px;color:rgba(74,158,255,.7);margin-top:2px;">skips first {{ skip_windup_ticks }}tk when chained into</div>
    </div>

    <div style="height:1px;background:#3a3a3a;margin:4px 0;"></div>

    <!-- Instructions -->
    <div style="padding:7px 12px 4px;display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:12px;color:#777777;text-transform:uppercase;letter-spacing:.08em;">Instructions</span>
      <span style="font-size:12px;color:#777777;">▶ {{ phTick }}tk</span>
    </div>

    <div v-if="instrTicks.length === 0"
         style="font-size:13px;color:#777777;text-align:center;padding:10px 12px;">
      no instructions yet
    </div>

    <div v-for="(it, i) in instrTicks" :key="i"
         style="display:flex;align-items:center;gap:7px;padding:6px 12px;cursor:pointer;min-height:32px;"
         @click="seekTo(it.tick)"
         :title="'Click to seek · Double-click to rename'"
         onmouseover="this.style.background='#2a2a2a'"
         onmouseout="this.style.background='transparent'">
      <div :style="{width:'8px',height:'8px',borderRadius:'50%',flexShrink:0,background:instrColor(it.label)}"></div>
      <span style="font-size:12px;color:#777777;width:36px;text-align:right;flex-shrink:0;">{{ it.tick }}tk</span>
      <span :style="{flex:1,fontSize:'14px',fontFamily:'monospace',color:instrColor(it.label),overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}"
            @dblclick.stop="renameInstr(i)"
            :title="it.label + ' — double-click to rename'">{{ it.label }}</span>
      <span @click.stop="deleteInstr(i)"
            style="font-size:13px;color:#777777;cursor:pointer;padding:0 3px;flex-shrink:0;transition:color .1s;"
            onmouseover="this.style.color='#e05555'"
            onmouseout="this.style.color='#777777'"
            title="Delete">✕</span>
    </div>

    <!-- Add instruction -->
    <div style="display:flex;gap:6px;padding:5px 12px 8px;align-items:center;min-width:0;">
      <input v-model="newInstr" type="text" placeholder="instruction name…"
        style="flex:1;min-width:0;background:#303030;border:1px solid #4a4a4a;color:#e0e0e0;
               padding:5px 8px;border-radius:2px;font-size:14px;
               font-family:'Segoe UI',system-ui,sans-serif;outline:none;"
        @keydown.enter="insert()">
      <button @click="insert()" :disabled="!newInstr.trim()"
          style="flex-shrink:0;width:52px;padding:5px 0;border-radius:2px;font-size:13px;
                 white-space:nowrap;transition:all .1s;font-family:'Segoe UI',system-ui,sans-serif;
                 background:#2a2a2a;cursor:pointer;"
          :style="{border:'1px solid '+(newInstr.trim()?instrColor(newInstr):'#4a4a4a'),
                   color:newInstr.trim()?instrColor(newInstr):'#777777',
                   cursor:newInstr.trim()?'pointer':'default'}">
          + add
      </button>
    </div>

    <div style="height:1px;background:#3a3a3a;margin:4px 0;"></div>

    <!-- Mod ID -->
    <div style="padding:6px 12px 3px;display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:12px;color:#777777;text-transform:uppercase;letter-spacing:.08em;">Mod ID</span>
      <span style="font-size:12px;color:#777777;">namespace prefix</span>
    </div>
    <input v-model="modId" type="text" placeholder="leklai"
      @change="saveModId()" @blur="saveModId()"
      style="display:block;width:calc(100% - 24px);margin:0 12px;background:#303030;
             border:1px solid #4a4a4a;color:#e0e0e0;padding:5px 8px;border-radius:2px;
             font-size:13px;font-family:monospace;outline:none;box-sizing:border-box;">
    <div style="font-size:11px;color:#555555;padding:4px 12px 8px;font-family:monospace;word-break:break-all;">
      data/{{ modId || 'leklai' }}/leklai/skill_animation_timing_sets/{{ exportFileName }}.json
    </div>

    <!-- Export / Import -->
    <div style="display:flex;gap:6px;padding:4px 12px 5px;">
      <button @click="doExport"
        style="flex:1;background:#242424;border:1px solid #4a9eff;color:#4a9eff;
               padding:7px 0;border-radius:2px;font-size:13px;cursor:pointer;
               font-family:'Segoe UI',system-ui,sans-serif;transition:background .1s;"
        onmouseover="this.style.background='rgba(74,158,255,.12)'"
        onmouseout="this.style.background='#242424'">
        ⬇ Export All
      </button>
      <button @click="doImport"
        style="flex:1;background:#242424;border:1px solid #4a4a4a;color:#b0b0b0;
               padding:7px 0;border-radius:2px;font-size:13px;cursor:pointer;
               font-family:'Segoe UI',system-ui,sans-serif;transition:background .1s;"
        onmouseover="this.style.background='#303030'"
        onmouseout="this.style.background='#242424'">
        ⬆ Import
      </button>
    </div>
    <div style="font-size:11px;color:#555555;text-align:center;padding:0 12px 8px;">
      Exports all initialized animations in this project into one JSON
    </div>

    <div style="height:1px;background:#3a3a3a;margin:4px 0;"></div>

    <!-- Remove skill data -->
    <div style="padding:5px 12px 12px;">
      <button @click="removeSkill"
        style="width:100%;background:#242424;border:1px solid #3a3a3a;color:#777777;
               padding:6px 0;border-radius:2px;font-size:13px;cursor:pointer;
               letter-spacing:.05em;font-family:'Segoe UI',system-ui,sans-serif;transition:all .1s;"
        onmouseover="this.style.borderColor='#e05555';this.style.color='#e05555'"
        onmouseout="this.style.borderColor='#3a3a3a';this.style.color='#777777'">
        ✕  Remove Skill Data
      </button>
    </div>

  </div><!-- end v-if="initialized" -->

  <!-- ⚠ Project-wide: animations with instructions but no timing data -->
  <div v-if="uninitWithInstrs.length > 0"
       style="margin:10px 12px 0;padding:8px 10px;background:#0f0900;border:1px solid #5a3a00;border-radius:2px;">
    <div style="font-size:13px;color:#7a5000;font-weight:600;margin-bottom:4px;">
      ⚠ {{ uninitWithInstrs.length }} anim(s) have instructions without timing data — server will ignore them:
    </div>
    <div v-for="name in uninitWithInstrs" :key="name"
         style="font-size:12px;color:#5a3a00;padding:2px 0;font-family:monospace;
                overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
         :title="name">· {{ name }}</div>
  </div>

  <div v-if="status"
       style="margin-top:6px;font-size:13px;color:#4caf7d;text-align:center;padding:5px 12px;">
    ✓ {{ status }}
  </div>

</div>
`,
            },
        });
    }

    // ── Events ────────────────────────────────────────────────────────────────
    var evts = [];
    function on(ev, fn) { Blockbench.on(ev, fn); evts.push([ev, fn]); }

    // ── Plugin ────────────────────────────────────────────────────────────────
    Plugin.register(ID, {
        title:       'Skill Timeline',
        author:      'knella',
        description: 'Docked phase panel + overlay for GeckoLib skill animations.',
        icon:        'sports_score',
        version:     '1.5.1',
        min_version: '5.0.0',
        variant:     'desktop',

        onload: function() {
            new Property(Animation, 'boolean', ID + '_init',       { default: false });
            new Property(Animation, 'number',  ID + '_windup_end', { default: 0 });
            new Property(Animation, 'number',  ID + '_active_end', { default: 0 });
            new Property(Animation, 'number',  ID + '_skip_windup',{ default: 0 });

            try { buildPanel(); } catch(e) {
                console.error('[skill_timings] Panel failed:', e);
            }

            on('select_animation', function() {
                if (sktPanel && sktPanel.vue) sktPanel.vue.load();
                queueDraw();
            });
            on('update_timeline', function() {
                queueDraw();
                if (sktPanel && sktPanel.vue) sktPanel.vue.load();
            });
            on('change_project_mode', function(e) {
                if (e.mode === 'animate') setTimeout(queueDraw, 200);
                else removeOverlay();
            });

            if (typeof Mode !== 'undefined' && Mode.selected && Mode.selected.id === 'animate') {
                setTimeout(queueDraw, 500);
            }
        },

        onunload: function() {
            evts.forEach(function(p) { Blockbench.removeListener(p[0], p[1]); });
            evts.length = 0;
            removeOverlay();
            if (sktPanel) { sktPanel.delete(); sktPanel = null; }
        },
    });

    window._sktDbg = function() {
        var tl = document.querySelector('#timeline');
        if (!tl) return console.warn('[skt] no #timeline');
        console.group('[skt] timeline DOM');
        [].slice.call(tl.querySelectorAll('*')).slice(0, 30).forEach(function(el) {
            console.log(el.tagName, el.id ? '#'+el.id : '', el.className, el.offsetWidth+'x'+el.offsetHeight);
        });
        console.groupEnd();
    };

})();
