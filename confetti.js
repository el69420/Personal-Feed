// ===== Confetti =====
function launchConfetti() {
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:99999;overflow:hidden;';
    document.body.appendChild(container);
    const colors = ['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#ff922b','#cc5de8','#ff4d9e'];
    for (let i = 0; i < 80; i++) {
        const p = document.createElement('div');
        const size = 6 + Math.random() * 8;
        const duration = 2 + Math.random() * 2;
        const delay = Math.random() * 1.5;
        const drift = Math.round(Math.random() * 120 - 60);
        p.style.cssText = `position:absolute;left:${Math.random()*100}%;top:-${size*2}px;`
            + `width:${size}px;height:${size*(0.4+Math.random()*0.8)}px;`
            + `background:${colors[Math.floor(Math.random()*colors.length)]};`
            + `border-radius:${Math.random()>0.5?'50%':'2px'};`
            + `animation:confetti-fall ${duration}s ${delay}s ease-in forwards;`
            + `--cf-drift:${drift}px;`;
        container.appendChild(p);
    }
    setTimeout(() => container.remove(), 5500);
}


export { launchConfetti };
