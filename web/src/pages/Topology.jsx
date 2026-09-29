import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, BaseEdge, EdgeLabelRenderer, useInternalNode, useReactFlow, applyNodeChanges } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import { Plus, Radar, LayoutGrid, Loader2, Trash2, SlidersHorizontal, TerminalSquare, Pencil } from 'lucide-react';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { Modal, Field, DeviceIcon, Dot, TYPE_META } from '../ui.jsx';
import { DeviceForm } from './Devices.jsx';

const W = 170, H = 60;
const shortIf = (n = '') => n.replace(/^TenGigabitEthernet|^Ten-GigabitEthernet/, 'Te').replace(/^GigabitEthernet/, 'Gi').replace(/^FastEthernet/, 'Fa').replace(/^Ethernet/, 'Eth').replace(/^Port-channel/, 'Po');

function layout(devices, links) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 70, ranksep: 110, marginx: 30, marginy: 30 });
  g.setDefaultEdgeLabel(() => ({}));
  devices.forEach((d) => g.setNode(d.id, { width: W, height: H }));
  links.forEach((l) => g.hasNode(l.a.deviceId) && g.hasNode(l.b.deviceId) && g.setEdge(l.a.deviceId, l.b.deviceId));
  dagre.layout(g);
  return Object.fromEntries(devices.map((d) => { const n = g.node(d.id); return [d.id, { x: n.x - W / 2, y: n.y - H / 2 }]; }));
}

function DeviceNode({ data, selected }) {
  const dot = data.virtual ? null : <Dot on={data.online} unknown={data.online === undefined} />;
  return (
    <div className={`node ${selected ? 'selected' : ''} ${data.virtual ? 'virtual' : ''}`}>
      <div className="ico"><DeviceIcon type={data.type} size={22} /></div>
      <div>
        <div className="t">{dot}{data.name}</div>
        <div className="s">{data.sub || TYPE_META[data.type]?.label}</div>
      </div>
      {['top', 'right', 'bottom', 'left'].map((p) => (
        <Handle key={p} id={p} type="source" position={Position[p[0].toUpperCase() + p.slice(1)]} style={{ opacity: 0, width: 10, height: 10 }} className="hdl" />
      ))}
    </div>
  );
}

/** Lien « flottant » : relie les bords des nœuds et affiche les interfaces aux deux bouts. */
function FloatingEdge({ id, source, target, data, selected }) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s?.measured?.width || !t?.measured?.width) return null;
  const c = (n) => ({ x: n.internals.positionAbsolute.x + n.measured.width / 2, y: n.internals.positionAbsolute.y + n.measured.height / 2, w: n.measured.width / 2, h: n.measured.height / 2 });
  const a = c(s), b = c(t);
  const edge = (from, to) => {
    const dx = to.x - from.x, dy = to.y - from.y;
    if (!dx && !dy) return { x: from.x, y: from.y };
    const k = Math.min(from.w / Math.abs(dx || 1e-9), from.h / Math.abs(dy || 1e-9));
    return { x: from.x + dx * k, y: from.y + dy * k };
  };
  let p1 = edge(a, b), p2 = edge(b, a);
  const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
  const off = (data.offset || 0) * 16;
  const nx = (-(p2.y - p1.y) / len) * off, ny = ((p2.x - p1.x) / len) * off;
  p1 = { x: p1.x + nx, y: p1.y + ny }; p2 = { x: p2.x + nx, y: p2.y + ny };
  const at = (k) => ({ x: p1.x + (p2.x - p1.x) * k, y: p1.y + (p2.y - p1.y) * k });
  const l1 = at(Math.min(0.22, 26 / len + 0.08)), l2 = at(1 - Math.min(0.22, 26 / len + 0.08)), mid = at(0.5);
  const Label = ({ p, text, extra }) => text ? (
    <div className={`edge-label ${selected ? 'sel' : ''}`} style={{ transform: `translate(-50%,-50%) translate(${p.x}px,${p.y}px)`, ...extra }}>{text}</div>
  ) : null;
  return (
    <>
      <BaseEdge id={id} path={`M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`} style={{ stroke: selected ? 'var(--accent)' : 'var(--line-2)', strokeWidth: selected ? 2.5 : 1.8, strokeDasharray: data.discovered ? undefined : undefined }} interactionWidth={20} />
      <EdgeLabelRenderer>
        <Label p={l1} text={shortIf(data.aIf)} />
        <Label p={l2} text={shortIf(data.bIf)} />
        <Label p={mid} text={data.label} extra={{ background: 'transparent', border: 'none', color: 'var(--accent)' }} />
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { device: DeviceNode };
const edgeTypes = { floating: FloatingEdge };

function LinkModal({ a, b, devices, onClose, onSave, existing }) {
  const name = (id) => devices.find((d) => d.id === id)?.name;
  const [f, setF] = useState(existing ? { aIf: existing.a.iface, bIf: existing.b.iface, label: existing.label || '' } : { aIf: '', bIf: '', label: '' });
  return (
    <Modal title={existing ? 'Modifier le lien' : 'Nouveau lien'} onClose={onClose} footer={<><button onClick={onClose}>Annuler</button><button className="primary" onClick={() => onSave(f)}>Enregistrer</button></>}>
      <div className="row">
        <Field label={`Interface sur ${name(a)}`}><input autoFocus value={f.aIf} onChange={(e) => setF({ ...f, aIf: e.target.value })} placeholder="Gi0/1" /></Field>
        <Field label={`Interface sur ${name(b)}`}><input value={f.bIf} onChange={(e) => setF({ ...f, bIf: e.target.value })} placeholder="eth0" /></Field>
      </div>
      <Field label="Libellé (optionnel)"><input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Trunk, VLAN 10…" /></Field>
    </Modal>
  );
}

function DiscoverModal({ onClose }) {
  const { devices, meta, reload, toast } = useApp();
  const capable = devices.filter((d) => !d.virtual && meta?.drivers.find((x) => x.id === d.vendor)?.capabilities.includes('neighbors'));
  const [results, setResults] = useState([]); // {device, neighbors|error}
  const [running, setRunning] = useState(true);
  const [picked, setPicked] = useState({});

  useEffect(() => {
    let stop = false;
    (async () => {
      for (const d of capable) {
        if (stop) return;
        try {
          const { neighbors } = await api.post(`/api/devices/${d.id}/discover`);
          setResults((r) => [...r, { device: d, neighbors }]);
          setPicked((p) => ({ ...p, ...Object.fromEntries(neighbors.filter((n) => !n.existing).map((n) => [n.id, true])) }));
        } catch (e) {
          setResults((r) => [...r, { device: d, error: e.message }]);
        }
      }
      setRunning(false);
    })();
    return () => { stop = true; };
    // eslint-disable-next-line
  }, []);

  const apply = async () => {
    let devs = 0, lks = 0;
    for (const r of results) {
      const sel = (r.neighbors || []).filter((n) => picked[n.id]);
      if (!sel.length) continue;
      const res = await api.post(`/api/devices/${r.device.id}/discover/apply`, { neighbors: sel });
      devs += res.created.length; lks += res.linked.length;
    }
    await reload();
    toast(`${devs} appareil(s) et ${lks} lien(s) ajoutés`);
    onClose();
  };

  return (
    <Modal title="Découverte du réseau (LLDP / CDP)" wide onClose={onClose} footer={<><button onClick={onClose}>Fermer</button><button className="primary" disabled={running || !Object.values(picked).some(Boolean)} onClick={apply}>Ajouter la sélection</button></>}>
      {!capable.length && <p className="muted">Aucun appareil compatible (Cisco IOS, HP ProCurve, HPE Comware) dans l’inventaire.</p>}
      {results.map((r) => (
        <div key={r.device.id} style={{ marginBottom: 14 }}>
          <b>{r.device.name}</b>
          {r.error && <div className="errors" style={{ marginTop: 6 }}>{r.error}</div>}
          {r.neighbors && !r.neighbors.length && <div className="muted small">Aucun voisin annoncé.</div>}
          {r.neighbors?.map((n) => (
            <label key={n.id} className="check" style={{ margin: '6px 0 0 4px' }}>
              <input type="checkbox" checked={!!picked[n.id]} onChange={(e) => setPicked({ ...picked, [n.id]: e.target.checked })} />
              <span className="mono">{n.localIf}</span> → <b>{n.remoteName || '?'}</b> <span className="mono muted">{n.remoteIf}</span>
              <span className="tag">{n.protocol}</span>
              {n.existing ? <span className="tag">déjà présent</span> : n.knownDeviceId ? <span className="tag accent">appareil connu</span> : <span className="tag accent">nouveau</span>}
            </label>
          ))}
        </div>
      ))}
      {running && capable.length > 0 && <div className="muted"><Loader2 className="spin" size={14} style={{ verticalAlign: -2 }} /> Interrogation des équipements…</div>}
    </Modal>
  );
}

function Canvas() {
  const { devices, links, status, reload, toast, setActiveId } = useApp();
  const nav = useNavigate();
  const rf = useReactFlow();
  const [nodes, setNodes] = useState([]);
  const [sel, setSel] = useState(null); // {kind:'node'|'edge', id}
  const [linkDraft, setLinkDraft] = useState(null);
  const [editLink, setEditLink] = useState(null);
  const [form, setForm] = useState(null);
  const [discover, setDiscover] = useState(false);
  const fitted = useRef(false);

  const auto = useMemo(() => layout(devices, links), [devices, links]);

  useEffect(() => {
    setNodes((prev) => devices.map((d) => {
      const old = prev.find((n) => n.id === d.id);
      return {
        id: d.id, type: 'device', position: old?.position || d.position || auto[d.id],
        selected: old?.selected,
        data: { name: d.name, type: d.type, virtual: d.virtual, online: status[d.id], sub: d.virtual ? d.ip : d.host || d.serialPath },
      };
    }));
  }, [devices, status, auto]);

  useEffect(() => {
    if (nodes.length && !fitted.current) { fitted.current = true; setTimeout(() => rf.fitView({ padding: 0.25, maxZoom: 1.1 }), 80); }
  }, [nodes, rf]);

  const edges = useMemo(() => {
    const seen = {};
    return links.map((l) => {
      const k = [l.a.deviceId, l.b.deviceId].sort().join('|');
      const offset = seen[k] = (seen[k] ?? -1) + 1;
      return { id: l.id, source: l.a.deviceId, target: l.b.deviceId, type: 'floating', selected: sel?.kind === 'edge' && sel.id === l.id, data: { aIf: l.a.iface, bIf: l.b.iface, label: l.label, offset, discovered: l.source === 'discovered' } };
    });
  }, [links, sel]);

  const savePositions = useCallback((ns) => api.put('/api/positions', Object.fromEntries(ns.map((n) => [n.id, n.position]))).catch(() => {}), []);

  const reorganize = async () => {
    const pos = layout(devices, links);
    setNodes((ns) => ns.map((n) => ({ ...n, position: pos[n.id] })));
    await api.put('/api/positions', pos);
    await reload();
    setTimeout(() => rf.fitView({ padding: 0.25, maxZoom: 1, duration: 300 }), 50);
  };

  const saveLink = async (f) => {
    try {
      if (editLink) await api.put(`/api/links/${editLink.id}`, { a: { ...editLink.a, iface: f.aIf }, b: { ...editLink.b, iface: f.bIf }, label: f.label });
      else await api.post('/api/links', { a: { deviceId: linkDraft.source, iface: f.aIf }, b: { deviceId: linkDraft.target, iface: f.bIf }, label: f.label });
      await reload();
      setLinkDraft(null); setEditLink(null);
    } catch (e) { toast(e.message, 'err'); }
  };

  const removeLink = async (id) => { await api.del(`/api/links/${id}`); setSel(null); await reload(); };
  const removeDevice = async (d) => {
    if (!confirm(`Supprimer « ${d.name} » ?`)) return;
    await api.del(`/api/devices/${d.id}`); setSel(null); await reload();
  };

  const selDevice = sel?.kind === 'node' && devices.find((d) => d.id === sel.id);
  const selLink = sel?.kind === 'edge' && links.find((l) => l.id === sel.id);
  const name = (id) => devices.find((d) => d.id === id)?.name;

  return (
    <div className="topo">
      <div className="topo-tools">
        <button onClick={() => setForm({})}><Plus size={15} /> Appareil</button>
        <button onClick={() => setForm({ virtualDefault: true })}><Plus size={15} /> Machine vide</button>
        <button onClick={() => setDiscover(true)}><Radar size={15} /> Découvrir</button>
        <button onClick={reorganize}><LayoutGrid size={15} /> Réorganiser</button>
      </div>
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        onNodesChange={(c) => setNodes((ns) => applyNodeChanges(c, ns))}
        onNodeDragStop={(_e, _n, all) => savePositions(all)}
        onNodeClick={(_e, n) => setSel({ kind: 'node', id: n.id })}
        onEdgeClick={(_e, ed) => setSel({ kind: 'edge', id: ed.id })}
        onPaneClick={() => setSel(null)}
        onConnect={(c) => c.source !== c.target && setLinkDraft(c)}
        connectionMode="loose" minZoom={0.2} maxZoom={2} proOptions={{ hideAttribution: true }} deleteKeyCode={null}
      >
        <Background gap={24} color="var(--line)" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable maskColor="rgba(0,0,0,.35)" nodeColor="var(--line-2)" style={{ background: 'var(--panel)' }} />
      </ReactFlow>

      {!devices.length && <div className="state" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>Ajoutez un appareil pour démarrer votre schéma.</div>}

      {selDevice && (
        <div className="card topo-side">
          <div className="name-cell"><div className="ico"><DeviceIcon type={selDevice.type} /></div><div><b>{selDevice.name}</b><div className="muted small">{TYPE_META[selDevice.type]?.label}</div></div></div>
          <p className="mono small muted" style={{ margin: '10px 0' }}>{selDevice.virtual ? selDevice.ip || 'machine vide' : selDevice.host || selDevice.serialPath}</p>
          <p className="small muted">{links.filter((l) => l.a.deviceId === selDevice.id || l.b.deviceId === selDevice.id).length} lien(s)</p>
          <div className="actions" style={{ marginTop: 12 }}>
            {!selDevice.virtual && <button onClick={() => { setActiveId(selDevice.id); nav('/config/interfaces'); }}><SlidersHorizontal size={14} /> Configurer</button>}
            {!selDevice.virtual && <button onClick={() => { setActiveId(selDevice.id); nav('/tools/console'); }}><TerminalSquare size={14} /></button>}
            <button onClick={() => setForm(selDevice)}><Pencil size={14} /></button>
            <button className="danger" onClick={() => removeDevice(selDevice)}><Trash2 size={14} /></button>
          </div>
        </div>
      )}
      {selLink && (
        <div className="card topo-side">
          <b>Lien</b>
          <p className="small" style={{ margin: '8px 0' }}>{name(selLink.a.deviceId)} <span className="mono muted">{selLink.a.iface}</span><br />{name(selLink.b.deviceId)} <span className="mono muted">{selLink.b.iface}</span></p>
          {selLink.source === 'discovered' && <span className="tag accent">découvert</span>}
          <div className="actions" style={{ marginTop: 12 }}>
            <button onClick={() => setEditLink(selLink)}><Pencil size={14} /> Modifier</button>
            <button className="danger" onClick={() => removeLink(selLink.id)}><Trash2 size={14} /></button>
          </div>
        </div>
      )}

      {(linkDraft || editLink) && (
        <LinkModal devices={devices} a={editLink ? editLink.a.deviceId : linkDraft.source} b={editLink ? editLink.b.deviceId : linkDraft.target} existing={editLink} onClose={() => { setLinkDraft(null); setEditLink(null); }} onSave={saveLink} />
      )}
      {form && <DeviceForm device={form.id ? form : null} virtualDefault={form.virtualDefault} onClose={() => setForm(null)} />}
      {discover && <DiscoverModal onClose={() => setDiscover(false)} />}
    </div>
  );
}

export default function Topology() {
  return <ReactFlowProvider><Canvas /></ReactFlowProvider>;
}
