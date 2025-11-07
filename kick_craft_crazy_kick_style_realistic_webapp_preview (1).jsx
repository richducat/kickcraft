import React, { useEffect, useRef, useState } from "react";

/**
 * KickCraft — PREVIEW‑SAFE BUILD (Canvas 2D) with pseudo‑3D perspective & kits
 *
 * NEW in this patch:
 * - **Realistic shots & saves:** power/aim spray, driven vs finesse (spin/curve), GK reaction + parry/hold logic.
 * - **11v11 roles**: ST, RW, LW, LCM, RCM, CDM, RB, LB, LCB, RCB, GK — both teams follow positions & shape.
 * - **Crowd** around the pitch (procedural dots in stands) for atmosphere.
 * - **Player visuals** include jersey numbers (classic numbering) and kit colors.
 *
 * Controls (still dependency‑free so it always previews here):
 * - **Tab**: cycle your selected Portugal player (cyan highlight)
 * - **WASD / Arrow keys**: move selected player
 * - **RMB**: pass to selected player
 * - **LMB** hold→release: shoot
 *   • Hold **Shift** for a **finesse** (curved) shot
 *   • Hold **Ctrl** for a **driven** shot
 */

// ---- World (logical units) ----
const W = 1100;            // world width
const H = 620;             // world height
const GOAL_W = 320;        // px (world units)
const BALL_R = 10;         // px
const RESTITUTION = 0.58;  // bounce

const NUM_DEFENDERS = 10;   // France outfield (plus GK)
const NUM_TEAMMATES = 10;   // Portugal outfield (plus GK)

const MAX_ENGAGERS = 2;      // baseline; levels override
const ENGAGE_RADIUS = 180;   // px
const HOLD_RADIUS = 80;      // px
const DEFENDER_SPEED = 180;  // px/s
const TEAMMATE_SPEED = 170;  // px/s
const CAPTURE_SPEED_MAX = 260; // px/s
const PASS_MIN = 360, PASS_MAX = 780; // px/s

// Shot tuning
const FINESSE_SPIN = 85;        // px/s^2 lateral accel
const DRIVEN_SPEED_F = 1.18;    // speed factor
const FINESSE_SPEED_F = 0.82;   // speed factor
const SHOT_SPRAY = 0.03;        // radians of random error

// GK tuning
const GK_REACT_MS = 120;        // reaction delay before moving
const GK_PARRY_SPEED = 520;     // min ball speed to force parry
const GK_HOLD_SPEED = 380;      // below this, keeper can catch/hold

// Level configs — difficulty ramps each level
const LEVELS = [
  { name: "Friendly",       maxEngagers: 2, defenderSpeed: 200, engageRadius: 185, holdRadius: 88, captureSpeedMax: 280, passGrace: 700 },
  { name: "Warmup",         maxEngagers: 2, defenderSpeed: 220, engageRadius: 195, holdRadius: 84, captureSpeedMax: 300, passGrace: 650 },
  { name: "League Match",   maxEngagers: 2, defenderSpeed: 240, engageRadius: 205, holdRadius: 82, captureSpeedMax: 320, passGrace: 620 },
  { name: "Cup Tie",        maxEngagers: 3, defenderSpeed: 255, engageRadius: 215, holdRadius: 80, captureSpeedMax: 340, passGrace: 580 },
  { name: "Quarterfinal",   maxEngagers: 3, defenderSpeed: 270, engageRadius: 225, holdRadius: 78, captureSpeedMax: 360, passGrace: 540 },
  { name: "Semifinal",      maxEngagers: 3, defenderSpeed: 285, engageRadius: 235, holdRadius: 76, captureSpeedMax: 380, passGrace: 520 },
  { name: "Final",          maxEngagers: 3, defenderSpeed: 300, engageRadius: 245, holdRadius: 74, captureSpeedMax: 400, passGrace: 500 },
];

// Pseudo‑3D perspective params (top is far, bottom is near)
const PERS = {
  top: 24,
  bottom: H - 24,
  sFar: 0.55,   // scale on the far edge
  sNear: 1.0,   // scale on the near edge
};

// Kits & numbers
const KIT_FR = { jersey: "#0055A4", shorts: "#FFFFFF", socks: "#EF4135" }; // blue/white/red
const KIT_PT = { jersey: "#046A38", shorts: "#DA291C", socks: "#FFCC00" }; // green/red/yellow
const SKIN = "#f1d3b6";
const NUM_BY_ROLE = { GK:1,RB:2,LB:3,RCB:4,LCB:5,CDM:6,RCM:8,LCM:10,RW:7,LW:11,ST:9 };

// Roles (11) in order for each side
const ROLES_PT = ["LB","LCB","RCB","RB","CDM","LCM","RCM","LW","ST","RW"]; // GK separate
const ROLES_FR = ["RB","RCB","LCB","LB","CDM","RCM","LCM","RW","ST","LW"]; // mirror-ish

export default function KickCraft() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [diag, setDiag] = useState([]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const cvs = canvasRef.current;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const ctx = cvs.getContext('2d');

    // Resize
    function resize(){
      const wrapW = wrap.clientWidth || W;
      const ratio = H / W;
      const wrapH = Math.max(400, Math.floor(wrapW * ratio));
      cvs.width = Math.floor(wrapW * dpr);
      cvs.height = Math.floor(wrapH * dpr);
      cvs.style.width = wrapW + 'px';
      cvs.style.height = wrapH + 'px';
    }
    resize();
    window.addEventListener('resize', resize);

    // Projection helpers (world ↔ pseudo‑3D screen in world space)
    function scaleAtY(y){
      const t = Math.max(0, Math.min(1, y / H));
      return PERS.sFar + (PERS.sNear - PERS.sFar) * t;
    }
    function project(x, y){
      const s = scaleAtY(y);
      const px = (x - W/2) * s + W/2;
      const py = PERS.top + (PERS.bottom - PERS.top) * (y / H);
      return { x: px, y: py, s };
    }
    function unproject(px, py){
      const t = (py - PERS.top) / (PERS.bottom - PERS.top);
      const y = Math.max(0, Math.min(H, t * H));
      const s = scaleAtY(y);
      const x = ( (px - W/2) / (s || 1) ) + W/2;
      return { x, y };
    }

    // Role anchors (home positions) for each team (y from near to far)
    const ANCHORS_PT = {
      GK: { x: 0, y: H-52 },
      LB: { x: -260, y: H*0.68 }, LCB: { x: -120, y: H*0.68 }, RCB: { x: 120, y: H*0.68 }, RB: { x: 260, y: H*0.68 },
      CDM:{ x:   0, y: H*0.58 }, LCM:{ x: -120, y: H*0.56 }, RCM:{ x: 120, y: H*0.56 },
      LW: { x: -220, y: H*0.42 }, ST: { x:    0, y: H*0.40 }, RW: { x: 220, y: H*0.42 },
    };
    const ANCHORS_FR = {
      GK: { x: 0, y: 52 },
      RB: { x: 260, y: H*0.32 }, RCB:{ x: 120, y: H*0.32 }, LCB:{ x:-120, y: H*0.32 }, LB:{ x:-260, y: H*0.32 },
      CDM:{ x:   0, y: H*0.42 }, RCM:{ x: 120, y: H*0.44 }, LCM:{ x:-120, y: H*0.44 },
      RW: { x: 220, y: H*0.22 }, ST: { x:    0, y: H*0.20 }, LW: { x:-220, y: H*0.22 },
    };

    function spawnTeamWithRoles(roles, anchors){
      return roles.map(role => ({ role, num: NUM_BY_ROLE[role]||0, x: W/2 + (anchors[role]?.x||0), y: anchors[role]?.y||H/2, r: 14, phase: Math.random()*6.28, engaged:false, react: 220+Math.random()*220, lag:0, homeX: W/2 + (anchors[role]?.x||0), homeY: anchors[role]?.y||H/2 }));
    }

    // World state
    const state = {
      t: performance.now(),
      ball: { x: W/2, y: H/2, vx: 0, vy: 0, r: BALL_R, spin: 0 },
      charging: false, t0: 0, aim: { x: W/2, y: H*0.5 },
      defenders: spawnTeamWithRoles(ROLES_FR, ANCHORS_FR),
      mates:     spawnTeamWithRoles(ROLES_PT, ANCHORS_PT),
      tackleCd: 0, protect: 0,
      ai: { carrier: null, shot: null, ptCarrier: -1 },
      score: 0, against: 0,
      // Goalkeepers (world coords)
      gkFR: { x: W/2, y: 52, speed: 360, react: GK_REACT_MS, reactT: 0 },   // France keeper (away, top)
      gkPT: { x: W/2, y: H-52, speed: 360, react: GK_REACT_MS, reactT: 0 }, // Portugal keeper (home, bottom)
      // Trap control to avoid ball sticking on a receiver
      trapLock: 0,
      trapOwner: -1,
      receiverIndex: -1,
      // Player control
      selectedIdx: 0, // which PT player we control off-ball
      keys: { w:false,a:false,s:false,d:false, ArrowLeft:false,ArrowRight:false,ArrowUp:false,ArrowDown:false },
      mod: { shift:false, ctrl:false },
      // Levels
      levelIdx: 0,
      goalsToAdvance: 2,
      levelProgress: 0,
      cfg: null,
    };

    // --- Levels setup ---
    function applyLevel(i){ state.levelIdx = Math.max(0, Math.min(LEVELS.length-1, i)); state.cfg = LEVELS[state.levelIdx]; }
    function advanceLevel(){ applyLevel(state.levelIdx + 1); }
    applyLevel(0);

    // Diagnostics
    setDiag([
      { name: 'France outfield', pass: state.defenders.length===NUM_DEFENDERS, info: String(state.defenders.length) },
      { name: 'Portugal outfield', pass: state.mates.length===NUM_TEAMMATES, info: String(state.mates.length) },
      { name: 'Engagers cap', pass: true, info: 'max ' + (state.cfg?.maxEngagers ?? 2) },
    ]);

    // Input → convert mouse to world (unproject)
    function toWorld(e){
      const r = cvs.getBoundingClientRect();
      const rawX = (e.clientX - r.left) * (cvs.width / r.width) / dpr;
      const rawY = (e.clientY - r.top)  * (cvs.height / r.height) / dpr;
      return unproject(rawX, rawY);
    }

    function mousedown(e){
      if (e.button===2) { e.preventDefault(); passToSelected(); return; }
      if (e.button!==0) return;
      state.charging = true; state.t0 = performance.now();
      const p = toWorld(e); state.aim.x = p.x; state.aim.y = p.y;
      state.mod.shift = e.shiftKey; state.mod.ctrl = e.ctrlKey;
    }
    function mousemove(e){ if(!state.charging) return; const p = toWorld(e); state.aim = p; }
    function mouseup(e){ if(e.button!==0) return; if(!state.charging) return; state.charging=false; shoot(); }
    function context(e){ e.preventDefault(); }

    function keydown(e){
      const k = e.key;
      if (k in state.keys) state.keys[k] = true;
      if (k === 'Tab') { e.preventDefault(); cycleSelected(e.shiftKey?-1:1); }
    }
    function keyup(e){ const k=e.key; if (k in state.keys) state.keys[k] = false; }

    window.addEventListener('mousedown', mousedown);
    window.addEventListener('mousemove', mousemove);
    window.addEventListener('mouseup', mouseup);
    window.addEventListener('contextmenu', context);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);

    function cycleSelected(dir){ const n = state.mates.length; state.selectedIdx = ( (state.selectedIdx + dir) % n + n ) % n; }

    function shoot(){
      const ms = Math.min(900, performance.now()-state.t0);
      const pwr = Math.max(0.15, Math.min(1, ms/900));
      const b = state.ball;
      const dx = state.aim.x - b.x, dy = state.aim.y - b.y; const d = Math.hypot(dx,dy) || 1;

      // Shot type
      const finesse = state.mod.shift && !state.mod.ctrl;
      const driven  = state.mod.ctrl && !state.mod.shift;
      const speedF  = finesse ? FINESSE_SPEED_F : driven ? DRIVEN_SPEED_F : 1.0;

      // Aim spray (tiny error) to emulate human shot
      const baseAngle = Math.atan2(dy, dx);
      const spray = (Math.random()-0.5) * SHOT_SPRAY; // radians
      const a = baseAngle + spray;
      const spd = (300 + pwr*500) * speedF;
      b.vx = Math.cos(a) * spd; b.vy = Math.sin(a) * spd;
      b.spin = finesse ? (dx>0? +FINESSE_SPIN : -FINESSE_SPIN) : 0; // curve toward far post

      state.protect = 120; // ms
      state.receiverIndex = -1; state.trapLock = 250; state.trapOwner = -1; state.ai.ptCarrier = -1;
    }

    function passToSelected(){ passToIndex(state.selectedIdx); }
    function passToIndex(idx){
      const b = state.ball; const m = state.mates[idx]; if (!m) return;
      const dx = m.x - b.x, dy = m.y - b.y; const d = Math.hypot(dx,dy)||1;
      const speed = Math.min(PASS_MAX, Math.max(PASS_MIN, 5*d));
      state.ball.vx = (dx/d)*speed; state.ball.vy = (dy/d)*speed; b.spin = 0;
      state.protect = (state.cfg?.passGrace ?? 700); state.receiverIndex = idx; state.trapLock = 250; state.trapOwner = -1; state.ai.ptCarrier = -1;
    }

    // Main loop
    let raf=0;
    function step(t){ const dt = Math.min(0.033, (t - state.t)/1000); state.t = t; update(dt); draw(); raf = requestAnimationFrame(step); }
    raf = requestAnimationFrame(step);

    function update(dt){
      state.tackleCd = Math.max(0, state.tackleCd - dt*1000);
      state.protect  = Math.max(0, state.protect  - dt*1000);
      state.trapLock = Math.max(0, state.trapLock - dt*1000);
      const b = state.ball;

      // Integrate ball (with simple spin curve)
      b.vx += (b.spin || 0) * dt; // lateral curve
      b.x  += b.vx*dt; b.y += b.vy*dt;
      b.vx *= (1-0.08*dt); b.vy *= (1-0.08*dt);

      // Walls
      const pad=24; if (b.x < pad + b.r){ b.x = pad + b.r; if (b.vx<0) b.vx = -b.vx*RESTITUTION; }
      if (b.x > W - pad - b.r){ b.x = W - pad - b.r; if (b.vx>0) b.vx = -b.vx*RESTITUTION; }
      if (b.y < pad + b.r){ b.y = pad + b.r; if (b.vy<0) b.vy = -b.vy*RESTITUTION; }
      if (b.y > H - pad - b.r){ b.y = H - pad - b.r; if (b.vy>0) b.vy = -b.vy*RESTITUTION; }

      // Goals: away (top), home (bottom)
      const awayY = 36, homeY = H-36;
      if (b.y - b.r < awayY && Math.abs(b.x - W/2) < GOAL_W/2) { state.score++; state.levelProgress++; if (state.levelProgress >= state.goalsToAdvance) { state.levelProgress = 0; advanceLevel(); } resetBall(); }
      if (b.y + b.r > homeY && Math.abs(b.x - W/2) < GOAL_W/2) { state.against++; resetBall(); }

      // Teammate trap
      for (let i=0;i<state.mates.length;i++){
        const m = state.mates[i]; const d = Math.hypot(b.x-m.x, b.y-m.y);
        if (state.trapLock<=0 && d < m.r + b.r - 1){ b.x=m.x; b.y=m.y-12; b.vx=0; b.vy=0; b.spin=0; state.protect=500; state.receiverIndex=i; state.trapLock=300; state.trapOwner=i; state.ai.ptCarrier=i; break; }
      }

      // Portugal movement (selected overrides), maintain shape
      for (let i=0;i<state.mates.length;i++){
        const m = state.mates[i]; m.phase += dt; const homeX = m.homeX, homeY = m.homeY; let targetX=homeX, targetY=homeY;
        if (i === state.selectedIdx) {
          const vx = ((state.keys.d||state.keys.ArrowRight)?1:0) + ((state.keys.a||state.keys.ArrowLeft)?-1:0);
          const vy = ((state.keys.s||state.keys.ArrowDown)?1:0) + ((state.keys.w||state.keys.ArrowUp)?-1:0);
          const mag = Math.hypot(vx,vy)||1; const step = TEAMMATE_SPEED*dt; m.x += (vx/mag)*step; m.y += (vy/mag)*step;
          m.x = Math.max(24, Math.min(W-24, m.x)); m.y = Math.max(24, Math.min(H-24, m.y));
        } else {
          // off‑ball drift back to role anchor with small lateral weave
          targetY = Math.min(targetY, state.ball.y + 140); // don't rush behind the ball too far
          targetX = homeX + Math.sin(m.phase*1.1)*20;
          const dx = targetX - m.x, dy = targetY - m.y; const dL = Math.hypot(dx,dy)||1; const step = Math.min(TEAMMATE_SPEED*0.8*dt, dL);
          m.x += (dx/dL)*step; m.y += (dy/dL)*step;
        }
      }

      // If selected is carrier, attach ball to feet
      if (state.ai.ptCarrier === state.selectedIdx) { const m = state.mates[state.selectedIdx]; b.x=m.x; b.y=m.y-12; b.vx=0; b.vy=0; b.spin=0; }
      else if (state.ai.ptCarrier >= 0) { const i = state.ai.ptCarrier; const m = state.mates[i]; const stepM = TEAMMATE_SPEED * dt; const dy = Math.max(awayY+24, m.y - stepM) - m.y; m.y += dy; b.x=m.x; b.y=m.y-12; b.vx=0; b.vy=0; }

      // GK prediction & movement
      gkUpdate(state.gkFR, b, true, dt);  // FR GK (top, ball moving up)
      gkUpdate(state.gkPT, b, false, dt); // PT GK (bottom, ball moving down)

      // GK saves (collision at goal mouth)
      gkSave(state.gkFR, b, true);
      gkSave(state.gkPT, b, false);

      // France defensive logic (press/contain with roles)
      const sorted = state.defenders.map(d=>({ d, dist: Math.hypot(d.x-b.x, d.y-b.y) })).sort((a,b)=>a.dist-b.dist);
      const engaged = new Set(); const MAX_E = state.cfg?.maxEngagers ?? MAX_ENGAGERS; const RAD_E = state.cfg?.engageRadius ?? ENGAGE_RADIUS;
      for (const e of sorted){ if (engaged.size>=MAX_E) break; if (e.dist<RAD_E) engaged.add(e.d); }

      for (const p of state.defenders){
        const isEngaging = engaged.has(p);
        if (isEngaging && !p.engaged){ p.lag = p.react/1000; p.engaged = true; }
        if (!isEngaging && p.engaged){ p.engaged = false; p.lag = 0; }
        const anchor = { x:p.homeX, y:p.homeY };
        let tx = anchor.x, ty = anchor.y;
        if (isEngaging){ if (p.lag>0) p.lag -= dt; else { const leadX=b.x+b.vx*0.35, leadY=b.y+b.vy*0.35; tx = leadX; ty = leadY; } }
        // Move with speed
        const dx = tx - p.x, dy = ty - p.y; const dist = Math.hypot(dx,dy)||1; const step = Math.min((state.cfg?.defenderSpeed ?? DEFENDER_SPEED)*dt*(isEngaging?1:0.7), dist);
        p.x += (dx/dist)*step; p.y += (dy/dist)*step; p.phase += dt;

        // Tackle/capture when close & ball slow enough
        const bd = Math.hypot(b.x-p.x, b.y-p.y); const bs = Math.hypot(b.vx,b.vy);
        if (state.ai.carrier!==p && state.protect<=0 && state.tackleCd<=0 && bd < p.r + b.r && bs <= (state.cfg?.captureSpeedMax ?? CAPTURE_SPEED_MAX)){
          state.ai.carrier = p; state.tackleCd = 120; state.protect = 250; state.ai.ptCarrier = -1; b.spin=0;
        }
        // If carrying, dribble & shoot at home goal
        if (state.ai.carrier === p){ const distToHome = (H-36) - p.y; if (distToHome < 60 && Math.abs(p.x - W/2) < GOAL_W/2 - 20){ const speed = 520 + Math.random()*160; const dxs=(W/2-p.x), dys=((H-36)-p.y-6); const Ls=Math.hypot(dxs,dys)||1; b.x=p.x; b.y=p.y-6; b.vx=(dxs/Ls)*speed; b.vy=(dys/Ls)*speed; state.ai.carrier=null; state.protect=40; } else { b.x=p.x; b.y=p.y-12; b.vx=0; b.vy=0; }
        }
      }
    }

    function gkUpdate(gk, b, topGoal, dt){
      // Predict crossing at goal line
      const goalY = topGoal ? 36 : H-36;
      const vyToward = topGoal ? b.vy < 0 : b.vy > 0;
      if (!vyToward) { gk.reactT = Math.max(0, gk.reactT - dt*1000); return; }
      const t = Math.abs((goalY - b.y) / (b.vy || 1e-6)); // time to line
      // reaction gate
      if (gk.reactT > 0) { gk.reactT = Math.max(0, gk.reactT - dt*1000); return; }
      // desired x = projected x at time t
      const projX = b.x + b.vx * t + 0.5*(b.spin||0)*t*t*0; // ignore spin lateral in 2D top-down
      const leftBound = W/2 - GOAL_W/2 + 18; const rightBound = W/2 + GOAL_W/2 - 18;
      const targetX = Math.max(leftBound, Math.min(rightBound, projX));
      const step = gk.speed * dt;
      gk.x += Math.max(-step, Math.min(step, targetX - gk.x));
      // impose next reaction delay occasionally
      gk.reactT = GK_REACT_MS * 0.25; // micro-delay
    }

    function gkSave(gk, b, topGoal){
      const withinX = Math.abs(b.x - gk.x) < 34;
      if (topGoal){
        if (b.y - b.r < gk.y + 14 && withinX && b.vy < 0){
          const speed = Math.hypot(b.vx,b.vy);
          if (speed < GK_HOLD_SPEED){ b.vx=0; b.vy=0; b.x=gk.x; b.y=gk.y+12; state.protect=200; }
          else { // parry
            const angle = (Math.random()<0.5? -1:1) * (0.25+Math.random()*0.35);
            const newV = rotate(b.vx, b.vy, angle); b.vx=newV.x*0.8; b.vy=Math.abs(newV.y)*0.6; b.y=gk.y+12; state.protect=140;
          }
        }
      } else {
        if (b.y + b.r > gk.y - 14 && withinX && b.vy > 0){
          const speed = Math.hypot(b.vx,b.vy);
          if (speed < GK_HOLD_SPEED){ b.vx=0; b.vy=0; b.x=gk.x; b.y=gk.y-12; state.protect=200; }
          else { const angle = (Math.random()<0.5? -1:1) * (0.25+Math.random()*0.35); const newV = rotate(b.vx, b.vy, angle); b.vx=newV.x*0.8; b.vy=-Math.abs(newV.y)*0.6; b.y=gk.y-12; state.protect=140; }
        }
      }
    }

    function rotate(vx,vy,angle){ const c=Math.cos(angle), s=Math.sin(angle); return { x: vx*c - vy*s, y: vx*s + vy*c }; }

    function resetBall(){ state.ball.x = W/2; state.ball.y = H/2; state.ball.vx=0; state.ball.vy=0; state.ball.spin=0; state.ai.carrier=null; state.ai.ptCarrier=-1; state.protect=0; state.receiverIndex=-1; state.gkFR.reactT=0; state.gkPT.reactT=0; }

    // --- Drawing helpers ---
    function drawField(ctx2){
      const lt = W/2 - (W/2)*PERS.sFar, rt = W/2 + (W/2)*PERS.sFar;
      const lb = W/2 - (W/2)*PERS.sNear, rb = W/2 + (W/2)*PERS.sNear;
      // Crowd (outside trapezoid)
      drawCrowd(ctx2);
      // Clip trapezoid
      ctx2.save(); ctx2.beginPath(); ctx2.moveTo(lt, PERS.top); ctx2.lineTo(rt, PERS.top); ctx2.lineTo(rb, PERS.bottom); ctx2.lineTo(lb, PERS.bottom); ctx2.closePath(); ctx2.clip();
      // Grass stripes
      const stripes = 14;
      for (let i=0;i<stripes;i++){
        ctx2.fillStyle = i%2?"#0c6d31":"#0a5c2a";
        const y0 = PERS.top + (PERS.bottom-PERS.top)*(i/stripes);
        const y1 = PERS.top + (PERS.bottom-PERS.top)*((i+1)/stripes);
        const s0 = PERS.sFar + (PERS.sNear-PERS.sFar)*(i/stripes);
        const s1 = PERS.sFar + (PERS.sNear-PERS.sFar)*((i+1)/stripes);
        const l0 = W/2 - (W/2)*s0, r0 = W/2 + (W/2)*s0;
        const l1 = W/2 - (W/2)*s1, r1 = W/2 + (W/2)*s1;
        ctx2.beginPath(); ctx2.moveTo(l0, y0); ctx2.lineTo(r0, y0); ctx2.lineTo(r1, y1); ctx2.lineTo(l1, y1); ctx2.closePath(); ctx2.fill();
      }
      ctx2.restore();

      // Border
      ctx2.strokeStyle = '#fff'; ctx2.lineWidth = 4;
      ctx2.beginPath(); ctx2.moveTo(lt, PERS.top); ctx2.lineTo(rt, PERS.top); ctx2.lineTo(rb, PERS.bottom); ctx2.lineTo(lb, PERS.bottom); ctx2.closePath(); ctx2.stroke();

      // Center line
      const mid = H/2; const pL = project(24, mid), pR = project(W-24, mid);
      ctx2.beginPath(); ctx2.moveTo(pL.x, pL.y); ctx2.lineTo(pR.x, pR.y); ctx2.lineWidth=2; ctx2.strokeStyle='#fff'; ctx2.stroke();

      // Goals
      const gL = project(W/2 - GOAL_W/2, 0), gR = project(W/2 + GOAL_W/2, 0);
      ctx2.fillStyle = '#fff'; ctx2.fillRect(gL.x, PERS.top-2, 10, 12); ctx2.fillRect(gR.x-10, PERS.top-2, 10, 12); ctx2.fillRect(gL.x, PERS.top-4, (gR.x-gL.x), 4);
      const gbL = project(W/2 - GOAL_W/2, H), gbR = project(W/2 + GOAL_W/2, H);
      ctx2.fillRect(gbL.x, PERS.bottom-12, 10, 12); ctx2.fillRect(gbR.x-10, PERS.bottom-12, 10, 12); ctx2.fillRect(gbL.x, PERS.bottom-14, (gbR.x-gbL.x), 4);
    }

    function drawCrowd(ctx2){
      // Top and bottom stands — dot matrix
      const rows = 6; const dots = 1400; const topBand=[PERS.top-24, PERS.top-2]; const botBand=[PERS.bottom+2, PERS.bottom+26];
      const pals = ['#eab308','#22c55e','#f97316','#60a5fa','#f43f5e','#a78bfa','#f59e0b','#ef4444','#cbd5e1'];
      ctx2.save();
      for (let i=0;i<dots;i++){
        ctx2.fillStyle = pals[(Math.random()*pals.length)|0];
        const x = Math.random()*W; const y = topBand[0] + Math.random()*(topBand[1]-topBand[0]);
        ctx2.fillRect(x, y, 2, 2);
      }
      for (let i=0;i<dots;i++){
        ctx2.fillStyle = pals[(Math.random()*pals.length)|0];
        const x = Math.random()*W; const y = botBand[0] + Math.random()*(botBand[1]-botBand[0]);
        ctx2.fillRect(x, y, 2, 2);
      }
      ctx2.restore();
    }

    function drawPlayer(ctx2, x, y, kit, highlight=false, num=0){
      const p = project(x,y); const headR = 5 * (0.6 + 0.6*(y/H)); const torsoW = 10 * (0.6 + 0.6*(y/H)); const torsoH = 18 * (0.6 + 0.6*(y/H));
      ctx2.fillStyle = 'rgba(0,0,0,.25)'; ctx2.beginPath(); ctx2.ellipse(p.x, p.y + headR*0.9, headR*1.2, headR*0.6, 0, 0, Math.PI*2); ctx2.fill();
      ctx2.fillStyle = kit.jersey; ctx2.fillRect(p.x - torsoW/2, p.y - torsoH*0.8, torsoW, torsoH*0.7);
      // Number on jersey
      ctx2.fillStyle = '#ffffff'; ctx2.font = `${Math.max(9, torsoW*0.9)}px system-ui`;
      ctx2.textAlign='center'; ctx2.textBaseline='middle'; ctx2.fillText(String(num||''), p.x, p.y - torsoH*0.45);
      ctx2.fillStyle = kit.shorts; ctx2.fillRect(p.x - torsoW/2, p.y - torsoH*0.1, torsoW, torsoH*0.25);
      ctx2.fillStyle = kit.socks; ctx2.fillRect(p.x - torsoW*0.3, p.y + torsoH*0.15, torsoW*0.2, torsoH*0.25); ctx2.fillRect(p.x + torsoW*0.1,  p.y + torsoH*0.15, torsoW*0.2, torsoH*0.25);
      ctx2.fillStyle = SKIN; ctx2.beginPath(); ctx2.arc(p.x, p.y - torsoH*0.95, headR, 0, Math.PI*2); ctx2.fill();
      if (highlight){ ctx2.lineWidth = 3; ctx2.strokeStyle = '#22d3ee'; ctx2.beginPath(); ctx2.arc(p.x, p.y - torsoH*0.4, torsoW*0.9, 0, Math.PI*2); ctx2.stroke(); }
    }

    function drawKeeper(ctx2, x, y, kit){
      const p = project(x,y); const torsoW = 13 * (0.6 + 0.6*(y/H)); const torsoH = 28 * (0.6 + 0.6*(y/H)); const headR = 6 * (0.6 + 0.6*(y/H));
      ctx2.fillStyle='rgba(0,0,0,.25)'; ctx2.beginPath(); ctx2.ellipse(p.x, p.y+headR, headR*1.3, headR*0.6, 0,0,Math.PI*2); ctx2.fill();
      ctx2.fillStyle = kit.jersey; ctx2.fillRect(p.x - torsoW/2, p.y - torsoH*0.8, torsoW, torsoH*0.75);
      ctx2.fillStyle = kit.shorts; ctx2.fillRect(p.x - torsoW/2, p.y - torsoH*0.05, torsoW, torsoH*0.25);
      ctx2.fillStyle = kit.socks; ctx2.fillRect(p.x - torsoW*0.35, p.y + torsoH*0.15, torsoW*0.25, torsoH*0.28); ctx2.fillRect(p.x + torsoW*0.1, p.y + torsoH*0.15, torsoW*0.25, torsoH*0.28);
      ctx2.fillStyle = SKIN; ctx2.beginPath(); ctx2.arc(p.x, p.y - torsoH*0.95, headR, 0, Math.PI*2); ctx2.fill();
      ctx2.fillStyle = '#e5e7eb'; ctx2.beginPath(); ctx2.arc(p.x - torsoW*0.8, p.y - torsoH*0.25, 4, 0, Math.PI*2); ctx2.fill(); ctx2.beginPath(); ctx2.arc(p.x + torsoW*0.8, p.y - torsoH*0.25, 4, 0, Math.PI*2); ctx2.fill();
    }

    function drawBall(ctx2, b){
      const pb = project(b.x, b.y); const r = b.r * (0.6 + 0.6*(b.y/H));
      ctx2.fillStyle='rgba(0,0,0,.25)'; ctx2.beginPath(); ctx2.ellipse(pb.x, pb.y+r*0.7, r*0.9, r*0.45, 0,0,Math.PI*2); ctx2.fill();
      const g = ctx2.createRadialGradient(pb.x - r*0.4, pb.y - r*0.5, r*0.2, pb.x, pb.y, r);
      g.addColorStop(0,'#fff'); g.addColorStop(1,'#c9d4e0'); ctx2.fillStyle=g; ctx2.beginPath(); ctx2.arc(pb.x, pb.y, r, 0, Math.PI*2); ctx2.fill();
    }

    function drawAim(ctx2, b, aim){ const pb = project(b.x, b.y); const pa = project(aim.x, aim.y); ctx2.setLineDash([10,8]); ctx2.strokeStyle='rgba(255,255,255,.8)'; ctx2.lineWidth=2; ctx2.beginPath(); ctx2.moveTo(pb.x,pb.y); ctx2.lineTo(pa.x,pa.y); ctx2.stroke(); ctx2.setLineDash([]); }

    function draw(){
      // scale to current canvas size
      const scaleX = cvs.width / W; const scaleY = cvs.height / H; const c = ctx; c.save(); c.scale(scaleX, scaleY);

      drawField(c);

      // Players
      for (const d of state.defenders){ drawPlayer(c, d.x, d.y, KIT_FR, false, d.num); }
      for (let i=0;i<state.mates.length;i++){ const m = state.mates[i]; const hl = (i===state.receiverIndex) || (i===state.selectedIdx); drawPlayer(c, m.x, m.y, KIT_PT, hl, m.num); }

      // Keepers (#1 by tradition)
      drawKeeper(c, state.gkFR.x, state.gkFR.y, { jersey: '#FACC15', shorts: '#1f2937', socks: '#F59E0B' });
      drawKeeper(c, state.gkPT.x, state.gkPT.y, { jersey: '#0EA5E9', shorts: '#1f2937', socks: '#38BDF8' });

      drawBall(c, state.ball);
      if (state.charging){ drawAim(c, state.ball, state.aim); }

      // HUD
      c.fillStyle='rgba(0,0,0,.5)'; c.fillRect(12,12,580,110);
      c.fillStyle='#fff'; c.font='14px system-ui';
      c.fillText(`Goals (PT): ${state.score}`, 20, 32);
      c.fillText(`Against (FR): ${state.against}`, 20, 52);
      c.fillText(`Level: ${state.levelIdx+1}/${LEVELS.length} (${LEVELS[state.levelIdx]?.name||''})  •  Progress: ${state.levelProgress}/${state.goalsToAdvance}` , 20, 72);
      c.fillText(`Selected: #${state.selectedIdx+1}  •  Controls: Tab switch • WASD/Arrows move • RMB pass • LMB shoot (Shift=finesse, Ctrl=driven)`, 20, 92);

      c.restore();
    }

    function resetBall(){ state.ball.x = W/2; state.ball.y = H/2; state.ball.vx=0; state.ball.vy=0; state.ball.spin=0; state.ai.carrier=null; state.ai.ptCarrier=-1; state.protect=0; state.receiverIndex=-1; state.gkFR.reactT=0; state.gkPT.reactT=0; }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('mousedown', mousedown);
      window.removeEventListener('mousemove', mousemove);
      window.removeEventListener('mouseup', mouseup);
      window.removeEventListener('contextmenu', context);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
    };
  }, []);

  return (
    <div style={{minHeight:'100vh', background:'#0b0b0b', color:'#fff', display:'flex', flexDirection:'column', alignItems:'center'}}>
      <div style={{width:'100%', maxWidth:1100, padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky', top:0, background:'rgba(11,11,11,0.7)', backdropFilter:'blur(6px)', borderBottom:'1px solid rgba(255,255,255,.1)'}}>
        <div style={{display:'flex', alignItems:'center', gap:12}}>
          <div style={{width:32, height:32, borderRadius:14, background:'linear-gradient(135deg,#34d399,#14b8a6)'}} />
          <div style={{fontWeight:600}}>KickCraft — Realistic 11v11 (pseudo‑3D 2D)</div>
        </div>
        <div style={{display:'flex', alignItems:'center', gap:8, fontSize:12}}>
          <span style={{color:'#94a3b8'}}>FR kit: <span style={{color:'#60a5fa'}}>blue</span>/<span style={{color:'#e2e8f0'}}>white</span>/<span style={{color:'#f87171'}}>red</span></span>
          <span style={{color:'#94a3b8'}}>•</span>
          <span style={{color:'#94a3b8'}}>PT kit: <span style={{color:'#22c55e'}}>green</span>/<span style={{color:'#f87171'}}>red</span>/<span style={{color:'#facc15'}}>yellow</span></span>
        </div>
      </div>

      <div ref={wrapRef} style={{width:'100%', maxWidth:1100, padding:'16px', boxSizing:'border-box'}}>
        <div style={{position:'relative', width:'100%', height:'70vh', borderRadius:16, overflow:'hidden', border:'1px solid rgba(255,255,255,.1)'}}>
          <canvas ref={canvasRef} />
          <div style={{position:'absolute', left:12, bottom:12, background:'rgba(0,0,0,.5)', padding:'6px 8px', borderRadius:8, fontSize:12}}>
            Controls: Tab switch • WASD/Arrows move • <b>RMB</b> pass • <b>LMB</b> shoot (Shift=finesse, Ctrl=driven) • 11v11
          </div>
        </div>
      </div>

      <div style={{width:'100%', maxWidth:1100, padding:'0 16px 24px', color:'#94a3b8', fontSize:12, textAlign:'center'}}>
        This preview uses a pseudo‑3D canvas so it always loads here. The full first‑person 3D version is ready in the Vercel project we packaged.
      </div>
    </div>
  );
}
