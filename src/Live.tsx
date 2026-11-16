import "./live.css";

export type Frame = {
  epoch: number; total: number; loss: number; label: number;
  pixels: number[]; hidden: number[]; probs: number[];
};

const vector = (v: unknown, length: number, min: number, max: number) =>
  Array.isArray(v) && v.length === length &&
  v.every(n => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max);

export function parseFrame(line: string): Frame | null {
  if (!line.startsWith("@neuron ") || line.length > 8192) return null;
  try {
    const f = JSON.parse(line.slice(8));
    if (!f || !Number.isSafeInteger(f.epoch) || !Number.isSafeInteger(f.total) ||
      f.total < 1 || f.epoch < 0 || f.epoch > f.total ||
      !Number.isInteger(f.label) || f.label < 0 || f.label > 9 ||
      !Number.isFinite(f.loss) || f.loss < 0 ||
      !vector(f.pixels, 35, 0, 1) || !vector(f.hidden, 12, -1, 1) ||
      !vector(f.probs, 10, 0, 1)) return null;
    return f;
  } catch { return null; }
}

const indices = (n: number) => Array.from({length: n}, (_, i) => i);
const y = (i: number, n: number) => 25 + i * 118 / (n - 1);

export default function Live({frame}: {frame: Frame | null}) {
  const winner = frame ? frame.probs.indexOf(Math.max(...frame.probs)) : -1;
  // Display one input node per raster row; the model itself has 35 inputs.
  const input = indices(7).map(i => (frame?.pixels.slice(i * 5, i * 5 + 5)
    .reduce((a, b) => a + b, 0) ?? 0) / 5);
  return <section className="neuron-live" aria-label="Visualisation du réseau de neurones">
    <header><h2>Neural <em>Network</em></h2><span className="nl-tag">FROM SCRATCH</span></header>
    <div className="nl-board">
      <div className="nl-stats"><span>Époque <b>{frame ? frame.epoch + " / " + frame.total : "—"}</b></span>
        <span>Perte <b>{frame?.loss.toFixed(3) ?? "—"}</b></span></div>
      <svg className="nl-graph" viewBox="0 0 438 174" role="img"
        aria-label={frame ? "Chiffre " + frame.label + ", prédiction " + winner : "Réseau en attente de données"}>
        <text x="10" y="28">ENTRÉE</text>
        {indices(35).map(i => <rect key={i} x={10 + i % 5 * 10} y={46 + Math.floor(i / 5) * 10}
          width="9" height="9" fill={frame && frame.pixels[i] > 0.5 ? "#e0d8c7" : "#262722"}/>)}
        <text x="10" y="137">{frame ? "Label " + frame.label : "5 × 7"}</text>
        {input.map((a, i) => indices(12).map(j => <line key={i+"-"+j}
          x1="84" y1={y(i,7)} x2="190" y2={y(j,12)} stroke="#e2ad72"
          opacity={0.13 + a * Math.abs(frame?.hidden[j] ?? 0) * 0.45}/>))}
        {indices(12).map(j => indices(10).map(k => <line key={j+"-"+k}
          x1="190" y1={y(j,12)} x2="292" y2={y(k,10)} stroke={k === winner ? "#f4bb77" : "#bab8a9"}
          opacity={0.09 + Math.abs(frame?.hidden[j] ?? 0) * (frame?.probs[k] ?? 0) * 0.83}/>))}
        {input.map((a,i) => <circle key={i} cx="84" cy={y(i,7)} r="3.3"
          stroke="#a09887" fill={a ? "#a79b81" : "#20211d"}/>)}
        {indices(12).map(j => <circle key={j} cx="190" cy={y(j,12)} r="3.5" stroke="#ab8052"
          fill="#e8ae6b" fillOpacity={0.12 + Math.abs(frame?.hidden[j] ?? 0) * 0.88}/>)}
        {indices(10).map(k => <g key={k}><circle cx="292" cy={y(k,10)} r="5"
          fill={k === winner ? "#e5ac68" : "#24251f"} stroke="#938972"/>
          <text className="nl-digit" x="292" y={y(k,10)+2.7} textAnchor="middle"
            style={{fill:k === winner ? "#161511" : "#c5bdad"}}>{k}</text>
          <rect x="305" y={y(k,10)-2} width="77" height="4" rx="1" fill="#242620"/>
          <rect x="305" y={y(k,10)-2} width={77*(frame?.probs[k] ?? 0)} height="4" rx="1"
            fill={k === winner ? "#8ecb8a" : "#787b68"}/>
          <text x="389" y={y(k,10)+3}>{frame ? Math.round(100*frame.probs[k])+"%" : "—"}</text></g>)}
        <text x="84" y="166" textAnchor="middle">35 entrées</text>
        <text x="190" y="166" textAnchor="middle">12 · tanh</text>
        <text x="292" y="166" textAnchor="middle">10 · softmax</text>
      </svg>
      <div className="nl-foot"><i className={frame ? "nl-lit" : ""}/>{frame
        ? "Prédiction " + winner + " · confiance " + (100 * frame.probs[winner]).toFixed(1) + " %"
        : "Exécutez la démo pour visualiser l’apprentissage."}</div>
    </div>
  </section>;
}
