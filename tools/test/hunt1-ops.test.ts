// The transition hunt's Stage 1 AWS operations (runs/scaffold/ops-hunt1: launch.sh, supervise.sh, bootstrap.sh, finish.sh, and the instance
// scripts tools/hunt1-ops/start.sh and watchdog.sh), run for real under /bin/bash against stubs: a fake `aws` (a small in-memory EC2 with
// failure injection), `ssh` and `rsync` (a fake instance's home is a directory), `curl`, `launchctl`, `sudo`, `deno`. Nothing here reaches AWS or a
// host; the stubs come first on PATH, the scratch directory holds copies of the scripts, and no key or credential file is read.
// The ops scripts live in runs/ (gitignored): those suites are skipped where they are absent.
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OPS = join(REPO, "runs", "scaffold", "ops-hunt1");
const HUNT_OPS = join(REPO, "tools", "hunt1-ops");
const OPS_SCRIPTS = ["launch.sh", "supervise.sh", "bootstrap.sh", "finish.sh", "make-src.sh"];
const haveOps = OPS_SCRIPTS.every((f) => existsSync(join(OPS, f)));
const describeOps = haveOps ? describe : describe.skip;

// ---------------------------------------------------------------------------------------------------------------------------------
// The stubs

/** A fake `aws ec2 ...`: state in $FAKE/state.json (keypairs, sgs, instances, tokens, inject rules), every call logged to $FAKE/calls.log. */
const FAKE_AWS = String.raw`#!/usr/bin/env python3
import base64, datetime, hashlib, json, os, re, sys, time

FAKE = os.environ["FAKE"]
SP = FAKE + "/state.json"
S = json.load(open(SP))
for k, v in (("keypairs", {}), ("sgs", {}), ("instances", {}), ("tokens", {}), ("seq", 0), ("inject", []), ("fp_style", "padded")):
    S.setdefault(k, v)

def save():
    json.dump(S, open(SP, "w"))

def fail(code, op, msg="injected"):
    save()
    sys.stderr.write("An error occurred (%s) when calling the %s operation: %s\n" % (code, op, msg))
    sys.exit(254)

def timeout():
    save()
    sys.stderr.write("Read timeout on endpoint URL: injected\n")
    sys.exit(255)

args = sys.argv[1:]
open(FAKE + "/calls.log", "a").write(" ".join(args) + "\n")
while args and args[0] in ("--cli-connect-timeout", "--cli-read-timeout"):
    args = args[2:]
svc, op, rest = args[0], args[1], args[2:]
text = " ".join(sys.argv[1:])
opts, cur = {}, None
for t in rest:
    if t.startswith("--"):
        cur = t[2:]
        opts[cur] = []
    elif cur:
        opts[cur].append(t)

def opt(k, d=None):
    v = opts.get(k)
    return v[0] if v else d

def inject(name):
    for r in S["inject"]:
        if r["op"] == name and r.get("match", "") in text and r.get("times", 1) != 0:
            if r.get("times", 1) > 0:
                r["times"] = r.get("times", 1) - 1
            return r
    return None

def filters():
    out = []
    for f in opts.get("filters", []):
        m = re.match(r"Name=([^,]+),Values=(.*)$", f)
        out.append((m.group(1), m.group(2).split(",")))
    return out

# a small JMESPath: fields, [n], [], [?Key==<backtick>value<backtick>], .[a,b]
def split_commas(s):
    out, depth, cur = [], 0, ""
    for c in s:
        if c == "[": depth += 1
        if c == "]": depth -= 1
        if c == "," and depth == 0:
            out.append(cur); cur = ""
        else:
            cur += c
    return out + [cur]

def matching(q, i):
    depth = 0
    for j in range(i, len(q)):
        if q[j] == "[": depth += 1
        if q[j] == "]":
            depth -= 1
            if depth == 0: return j
    raise ValueError(q)

def parse(q):
    steps, i, n = [], 0, len(q)
    while i < n:
        c = q[i]
        if c == ".":
            i += 1
            if i < n and q[i] == "[":
                j = matching(q, i)
                steps.append(("multi", [parse(p) for p in split_commas(q[i + 1:j])]))
                i = j + 1
            continue
        if c == "[":
            j = matching(q, i)
            inner = q[i + 1:j]
            if inner == "": steps.append(("flatten", None))
            elif inner.startswith("?"):
                m = re.match(r"\?(\w+)==\x60(.*)\x60$", inner)
                steps.append(("filter", (m.group(1), json.loads(m.group(2)))))
            else: steps.append(("index", int(inner)))
            i = j + 1
            continue
        j = i
        while j < n and (q[j].isalnum() or q[j] in "_-"): j += 1
        if j == i: raise ValueError(q)
        steps.append(("field", q[i:j]))
        i = j
    return steps

def apply(k, a, v):
    if k == "field": return v.get(a) if isinstance(v, dict) else None
    if k == "index": return v[a] if isinstance(v, list) and -len(v) <= a < len(v) else None
    if k == "multi": return [evaluate(sub, v) for sub in a]

def evaluate(steps, data):
    v, proj = data, False
    for k, a in steps:
        if v is None: return None
        if k == "flatten":
            if not isinstance(v, list): return None
            flat = []
            for e in v:
                flat.extend(e) if isinstance(e, list) else flat.append(e)
            v, proj = flat, True
        elif k == "filter":
            if not isinstance(v, list): return None
            v, proj = [e for e in v if isinstance(e, dict) and e.get(a[0]) == a[1]], True
        elif proj:
            out = [apply(k, a, e) for e in v]
            v = [x for x in out if x is not None]
        else:
            v = apply(k, a, v)
    return v

def scalar(x):
    return "None" if x is None else ("True" if x is True else "False" if x is False else str(x))

def as_text(v):
    if isinstance(v, list):
        if all(not isinstance(x, list) for x in v): return "\t".join(scalar(x) for x in v)
        return "\n".join(as_text(x) for x in v)
    return scalar(v)

def out(data):
    save()
    q = opt("query")
    v = evaluate(parse(q), data) if q else data
    if opt("output") == "text":
        print(as_text(v))
    else:
        print(json.dumps(v))
    sys.exit(0)

def inst_json(iid, i):
    return {"InstanceId": iid, "InstanceType": i["type"], "LaunchTime": i["launch"], "KeyName": i["key"], "State": {"Name": i["state"]},
            "PublicIpAddress": i["ip"] if i["state"] == "running" else None, "Tags": [{"Key": "Name", "Value": i["name"]}]}

def inst_match(iid, i, fl):
    for name, vals in fl:
        v = {"tag:Name": i["name"], "key-name": i["key"], "instance-state-name": i["state"], "instance-id": iid, "client-token": i.get("token") or ""}.get(name)
        if v is not None and v not in vals: return False
    return True

def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")

if op == "describe-instances":
    r = inject(op)
    if r and r["mode"] == "empty": out({"Reservations": []})   # a lookup that does not see the instance yet (eventual consistency)
    if r: timeout() if r["mode"] == "timeout" else fail(r["mode"].split(":")[1], op)
    ids = opts.get("instance-ids")
    if ids:
        for iid in ids:
            if iid not in S["instances"]: fail("InvalidInstanceID.NotFound", op)
    fl = filters()
    out({"Reservations": [{"Instances": [inst_json(iid, i)]} for iid, i in S["instances"].items() if (not ids or iid in ids) and inst_match(iid, i, fl)]})
elif op == "run-instances":
    tok = opt("client-token")
    name = re.search(r"ResourceType=instance,Tags=\[\{Key=Name,Value=([^,}]+)", " ".join(opts.get("tag-specifications", []))).group(1)
    r = inject(op)
    created = None
    ud = open(opt("user-data").replace("file://", "")).read() if opt("user-data") else None
    if r and r["mode"] == "drop-userdata":
        ud, r = None, None
    if r and r["mode"] == "created-then-timeout":
        pass
    elif r:
        timeout() if r["mode"] == "timeout" else fail(r["mode"].split(":")[1], op)
    if tok in S["tokens"]:
        created = S["tokens"][tok]
    else:
        S["seq"] += 1
        created = "i-%017x" % S["seq"]
        num = name.rsplit("-", 1)[-1]
        S["instances"][created] = {"name": name, "state": "running", "type": opt("instance-type"), "key": opt("key-name"), "launch": now_iso(), "ip": "10.0.0.%s" % (num if num.isdigit() else 100 + S["seq"]), "userdata": ud, "shutdown": opt("instance-initiated-shutdown-behavior"), "token": tok}
        S["tokens"][tok] = created
    if r: timeout()
    out({"Instances": [inst_json(created, S["instances"][created])]})
elif op == "describe-instance-attribute":
    i = S["instances"].get(opt("instance-id"))
    if i is None: fail("InvalidInstanceID.NotFound", op)
    out({"InstanceId": opt("instance-id"), "UserData": {"Value": base64.b64encode(i["userdata"].encode()).decode()} if i.get("userdata") else {}})
elif op == "terminate-instances":
    for iid in opts["instance-ids"]:
        if iid not in S["instances"]: fail("InvalidInstanceID.NotFound", op)
        S["instances"][iid]["state"] = "terminated"
    out({"TerminatingInstances": [{"InstanceId": iid, "CurrentState": {"Name": "shutting-down"}} for iid in opts["instance-ids"]]})
elif op == "start-instances":
    for iid in opts["instance-ids"]:
        S["instances"][iid]["state"] = "running"
    out({"StartingInstances": []})
elif op == "wait":
    r = inject(op)
    if r: fail(r["mode"].split(":")[1], op)
    save(); sys.exit(0)
elif op == "describe-key-pairs":
    r = inject(op)
    if r: timeout() if r["mode"] == "timeout" else fail(r["mode"].split(":")[1], op)
    out({"KeyPairs": [{"KeyName": k, "KeyFingerprint": v["fp"]} for k, v in S["keypairs"].items() if all(k in vals for n, vals in filters() if n == "key-name")]})
elif op == "import-key-pair":
    blob = base64.b64decode(open(opt("public-key-material").replace("fileb://", "")).read().split()[1])
    d = base64.b64encode(hashlib.sha256(blob).digest()).decode()
    S["keypairs"][opt("key-name")] = {"fp": ("SHA256:" + d.rstrip("=")) if S["fp_style"] == "prefixed" else d}
    out({"KeyPairId": "key-0001"})
elif op == "delete-key-pair":
    S["keypairs"].pop(opt("key-name"), None)
    out({})
elif op == "describe-security-groups":
    fl = filters()
    ids = opts.get("group-ids")
    res = []
    for gid, g in S["sgs"].items():
        if ids and gid not in ids: continue
        if any(n == "group-id" and gid not in vals for n, vals in fl): continue
        if any(n == "group-name" and g["name"] not in vals for n, vals in fl): continue
        if any(n == "vpc-id" and g["vpc"] not in vals for n, vals in fl): continue
        res.append({"GroupId": gid, "GroupName": g["name"], "VpcId": g["vpc"], "IpPermissions": [{"FromPort": 22, "ToPort": 22, "IpProtocol": "tcp", "IpRanges": [{"CidrIp": c} for c in g["rules"]]}] if g["rules"] else []})
    out({"SecurityGroups": res})
elif op == "create-security-group":
    for g in S["sgs"].values():
        if g["name"] == opt("group-name") and g["vpc"] == opt("vpc-id"): fail("InvalidGroup.Duplicate", op)
    gid = "sg-%04d" % (len(S["sgs"]) + 1)
    S["sgs"][gid] = {"name": opt("group-name"), "vpc": opt("vpc-id"), "rules": []}
    out({"GroupId": gid})
elif op == "authorize-security-group-ingress":
    g = S["sgs"][opt("group-id")]
    if opt("cidr") in g["rules"]: fail("InvalidPermission.Duplicate", op)
    g["rules"].append(opt("cidr"))
    out({"Return": True})
elif op == "delete-security-group":
    r = inject(op)
    if r: fail(r["mode"].split(":")[1], op)
    if opt("group-id") not in S["sgs"]: fail("InvalidGroup.NotFound", op)
    del S["sgs"][opt("group-id")]
    out({})
elif op == "describe-subnets":
    out({"Subnets": [{"SubnetId": "subnet-aaa", "AvailabilityZone": "us-east-1a"}, {"SubnetId": "subnet-bbb", "AvailabilityZone": "us-east-1b"}]})
else:
    sys.stderr.write("fake aws: unsupported " + op + "\n"); sys.exit(2)
`;

/** A fake `ssh`: runs the command in the fake instance's home ($FAKE/remote/<host>), unless a rule in $FAKE/ssh-rules.json answers it. */
const FAKE_SSH = String.raw`#!/usr/bin/env python3
import json, os, subprocess, sys
FAKE = os.environ["FAKE"]
a, i, host, cmd = sys.argv[1:], 0, None, []
while i < len(a):
    if a[i] in ("-i", "-o"): i += 2; continue
    if a[i].startswith("-"): i += 1; continue
    host, cmd = a[i].split("@")[-1], a[i + 1:]
    break
text = " ".join(cmd)
open(FAKE + "/ssh.log", "a").write(host + ": " + text + "\n")
rp = FAKE + "/ssh-rules.json"
for r in json.load(open(rp)) if os.path.exists(rp) else []:
    if r.get("host", host) == host and r["match"] in text:
        sys.stdout.write(r.get("stdout", ""))
        sys.exit(r.get("rc", 0))
home = FAKE + "/remote/" + host
if not os.path.isdir(home): sys.exit(255)
sys.exit(subprocess.call(["bash", "-c", text], cwd=home, env=dict(os.environ, HOME=home)))
`;

/** A fake `rsync` pulling from the fake instance's home: -a, --exclude (top-level patterns), the summary line; rules in $FAKE/rsync-rules.json can fail, hang or inflate it. */
const FAKE_RSYNC = String.raw`#!/usr/bin/env python3
import fnmatch, json, os, shutil, sys, time
FAKE = os.environ["FAKE"]
a, i, pos, excl = sys.argv[1:], 0, [], []
while i < len(a):
    if a[i] == "--exclude": excl.append(a[i + 1].strip("/")); i += 2; continue
    if a[i] == "-e": i += 2; continue
    if a[i].startswith("-"): i += 1; continue
    pos.append(a[i]); i += 1
src, dst = pos
host, path = src.split(":", 1)
host = host.split("@")[-1]
open(FAKE + "/rsync.log", "a").write(src + " -> " + dst + "\n")
received, delay = None, 0
rp = FAKE + "/rsync-rules.json"
for r in json.load(open(rp)) if os.path.exists(rp) else []:
    if r["match"] in src and (not r.get("end") or src.endswith(r["match"])):
        if r.get("hang"): time.sleep(600)
        if r.get("rc"): sys.stderr.write("rsync error: injected\n"); sys.exit(r["rc"])
        received, delay = r.get("received"), r.get("delay", 0)
real = FAKE + "/remote/" + host + "/" + path
if not os.path.isdir(real):
    sys.stderr.write("rsync: change_dir " + real + " failed: No such file or directory (2)\n"); sys.exit(23)
total, items = 0, []
for root, dirs, files in os.walk(real):
    rel = os.path.relpath(root, real)
    if rel == ".":
        dirs[:] = [d for d in dirs if not any(fnmatch.fnmatch(d, p) for p in excl)]
    for f in files:
        t = os.path.join(dst, rel, f) if rel != "." else os.path.join(dst, f)
        items.append((t, os.path.join(root, f), open(os.path.join(root, f), "rb").read()))   # the snapshot a slow transfer will write
        total += os.path.getsize(os.path.join(root, f))
time.sleep(delay)
for t, srcf, data in items:
    os.makedirs(os.path.dirname(t), exist_ok=True)
    open(t, "wb").write(data)
    shutil.copystat(srcf, t)
print("sent 100 bytes  received %d bytes  1.00 bytes/sec" % (received if received is not None else total + 100))
`;

/** A fake `setsid` (macOS has none): a new session and process group, then the command in the same process. */
const FAKE_SETSID = String.raw`#!/usr/bin/env python3
import os, sys, time
os.setsid()
time.sleep(float(os.environ.get("SETSID_DELAY", "0")))
os.execvp(sys.argv[1], sys.argv[1:])
`;

/** A fake `deno` for finish.sh: tools/run.ts writes a bundle (an unfinished one and "event buffer overflow" when $FAKE/overflow lists the experiment and census), the report records its arguments. */
const FAKE_DENO = String.raw`#!/usr/bin/env python3
import json, os, sys
FAKE = os.environ["FAKE"]
a = sys.argv[1:]
open(FAKE + "/deno.log", "a").write(" ".join(a) + "\n")
if "tools/run.ts" in a:
    g = lambda k: a[a.index(k) + 1]
    exp, cond, seed, census = g("--experiment"), g("--conditions"), g("--seeds"), g("--census")
    d = os.path.join(g("--out"), exp, "ponds", cond, "seed-" + seed)
    os.makedirs(d, exist_ok=True)
    ov = open(FAKE + "/overflow").read().split() if os.path.exists(FAKE + "/overflow") else []
    if exp + ":" + census in ov:
        json.dump({"spec": {"experiment": exp}}, open(d + "/manifest.json", "w"))
        sys.stderr.write("Error: event buffer overflow at step 1234\n")
        sys.exit(1)
    json.dump({"spec": {"experiment": exp, "censusEvery": int(census)}, "summary": {"finalHash": "x"}, "finishedAt": "t"}, open(d + "/manifest.json", "w"))
elif "tools/scaffold-report.ts" in a:
    print(json.dumps({"outcome": "test outcome"}))
`;

const SH = (body: string): string => `#!/bin/bash\n${body}\n`;
// The sandbox gives the scripts their own HOME, where a version manager's python3 shim (asdf, pyenv) cannot find its interpreter: the sandbox's
// python3 runs the real interpreter directly.
const PYTHON = spawnSync("python3", ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).stdout.trim();

// ---------------------------------------------------------------------------------------------------------------------------------
// The sandbox: a scratch workspace laid out like the real one (root/runs/scaffold/ops-hunt1), stubs first on PATH

interface Result {
  status: number | null;
  stdout: string;
  stderr: string;
}
const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

class Sandbox {
  readonly root = mkdtempSync(join(tmpdir(), "hunt1-ops-"));
  readonly ops = join(this.root, "runs", "scaffold", "ops-hunt1");
  readonly bin = join(this.root, "bin");
  readonly fake = join(this.root, "fake");
  readonly home = join(this.root, "home");
  constructor() {
    roots.push(this.root);
    for (const d of [this.ops, this.bin, this.fake, this.home]) mkdirSync(d, { recursive: true });
    const put = (name: string, body: string) => {
      writeFileSync(join(this.bin, name), body);
      chmodSync(join(this.bin, name), 0o755);
    };
    put("python3", SH(`exec "${PYTHON}" "$@"`));
    put("aws", FAKE_AWS);
    put("ssh", FAKE_SSH);
    put("rsync", FAKE_RSYNC);
    put("deno", FAKE_DENO);
    put("setsid", FAKE_SETSID);
    put("curl", SH('sleep "${CURL_DELAY:-0}"; echo 203.0.113.7'));
    put("launchctl", SH('echo "$@" >> "$FAKE/launchctl.log"'));
    put("sudo", SH('echo "$@" >> "$FAKE/sudo.log"'));
    // the scripts source awsenv.sh for credentials; the stand-in sets nothing secret
    writeFileSync(join(this.ops, "awsenv.sh"), "export AWS_DEFAULT_REGION=us-east-1\n");
    this.setState({ keypairs: {}, sgs: {}, instances: {}, tokens: {}, seq: 0, inject: [] });
  }
  /** Copies scripts (from OPS, or HUNT_OPS for the instance ones) into the sandbox's ops directory. */
  install(...names: string[]): void {
    for (const f of names) copyFileSync(existsSync(join(OPS, f)) ? join(OPS, f) : join(HUNT_OPS, f), join(this.ops, f));
  }
  env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    return { PATH: `${this.bin}:${process.env.PATH}`, HOME: this.home, FAKE: this.fake, TMPDIR: this.root, ...extra };
  }
  run(script: string, args: string[] = [], extra: Record<string, string> = {}, o: { cwd?: string; timeout?: number } = {}): Result {
    const r = spawnSync("/bin/bash", [script, ...args], { env: this.env(extra), cwd: o.cwd ?? this.root, encoding: "utf8", timeout: o.timeout ?? 120_000 });
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  }
  // the fake EC2 state
  state(): any {
    return JSON.parse(readFileSync(join(this.fake, "state.json"), "utf8"));
  }
  setState(s: any): void {
    writeFileSync(join(this.fake, "state.json"), JSON.stringify(s));
  }
  edit(f: (s: any) => void): void {
    const s = this.state();
    f(s);
    this.setState(s);
  }
  inject(...rules: { op: string; mode: string; match?: string; times?: number }[]): void {
    this.edit((s) => s.inject.push(...rules));
  }
  /** Adds rules answering ssh commands (matched by a substring of the command, for one host): a status, an output. */
  sshRules(rules: { match: string; host?: string; rc?: number; stdout?: string }[]): void {
    const p = join(this.fake, "ssh-rules.json");
    writeFileSync(p, JSON.stringify([...(existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : []), ...rules]));
  }
  /** Adds rules for rsync pulls (a substring of the source; \`end\`: it must end the source, the main pull and not the directories under it). */
  rsyncRules(rules: { match: string; end?: boolean; rc?: number; hang?: boolean; delay?: number; received?: number }[]): void {
    const p = join(this.fake, "rsync-rules.json");
    writeFileSync(p, JSON.stringify([...(existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : []), ...rules]));
  }
  clearRules(): void {
    for (const f of ["ssh-rules.json", "rsync-rules.json"]) rmSync(join(this.fake, f), { force: true });
  }
  fakeLog(name: string): string[] {
    const p = join(this.fake, name);
    return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean) : [];
  }
  calls(op: string): string[] {
    return this.fakeLog("calls.log").filter((l) => l.split(" ").includes(op) || l.split(" ")[1] === op);
  }
  file(p: string): string {
    return readFileSync(join(this.ops, p), "utf8");
  }
  has(p: string): boolean {
    return existsSync(join(this.ops, p));
  }
}

const mkSandbox = (): Sandbox => new Sandbox();

/** A process that holds an OS lock (flock) on `path`, as the scripts' own wrapper does; killing it (even SIGKILL) is what releases the lock. */
function holdLock(path: string): { pid: number; kill: () => void } {
  const marker = `${path}.held`;
  rmSync(marker, { force: true });
  const c = spawn(PYTHON, ["-c", "import fcntl,os,sys,time; fd=os.open(sys.argv[1], os.O_CREAT|os.O_RDWR, 0o644); fcntl.flock(fd, fcntl.LOCK_EX); open(sys.argv[2],'w').write('x'); time.sleep(600)", path, marker], { detached: true, stdio: "ignore" });
  c.unref();
  for (let i = 0; i < 100 && !existsSync(marker); i++) spawnSync("sleep", ["0.05"]);
  expect(existsSync(marker), "the holder took the lock").toBe(true);
  return {
    pid: c.pid!,
    kill: () => {
      try {
        process.kill(c.pid!, "SIGKILL");
      } catch {
        /* gone */
      }
      spawnSync("sleep", ["0.2"]);
    },
  };
}
const tryRead = (p: string): string => (existsSync(p) ? readFileSync(p, "utf8") : "");
const num = (s: string): number => Number(s.trim());

// ---------------------------------------------------------------------------------------------------------------------------------
// Syntax: every script under /bin/bash (3.2 on macOS) and the system bash, and shellcheck where installed

describe("the hunt's ops scripts parse", () => {
  const files = [
    ...["lane.sh", "start.sh", "watchdog.sh", "history.sh"].map((f) => join(HUNT_OPS, f)),
    ...(haveOps ? [...OPS_SCRIPTS.map((f) => join(OPS, f)), join(OPS, "devcheck.sh")] : []),
  ];
  it.each(files.map((f) => [f.replace(REPO + "/", ""), f]))("bash -n %s", (_n, f) => {
    for (const sh of ["/bin/bash", "bash"]) {
      const r = spawnSync(sh, ["-n", f], { encoding: "utf8" });
      expect(r.stderr, `${sh} -n ${f}`).toBe("");
      expect(r.status).toBe(0);
    }
  });
  const shellcheck = spawnSync("shellcheck", ["--version"], { encoding: "utf8" }).status === 0;
  it.skipIf(!shellcheck).each(files.map((f) => [f.replace(REPO + "/", ""), f]))("shellcheck (warnings) %s", (_n, f) => {
    const r = spawnSync("shellcheck", ["-s", "bash", "-S", "warning", f], { encoding: "utf8" });
    expect(r.stdout).toBe("");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// launch.sh

describeOps("launch.sh", () => {
  let sb: Sandbox;
  beforeEach(() => {
    sb = mkSandbox();
    sb.install("launch.sh");
  });
  const launch = (extra: Record<string, string> = {}) => sb.run(join(sb.ops, "launch.sh"), [], { LAUNCH_PAUSE: "0", ...extra }, { cwd: sb.ops });
  const liveInstances = (): [string, { name: string; type: string; state: string }][] => Object.entries(sb.state().instances).filter(([, i]) => (i as { state: string }).state !== "terminated") as never;

  it("launches three instances, records them with their launch times and starts the ledger at the earliest", () => {
    const before = Math.floor(Date.now() / 1000);
    const r = launch();
    expect(r.status, r.stderr + r.stdout).toBe(0);
    for (const n of [1, 2, 3]) {
      const id = sb.file(`instance-${n}`).trim();
      expect(sb.state().instances[id].name).toBe(`bl-scaf-hunt1-${n}`);
      expect(sb.file(`type-${n}`).trim()).toBe("g5.xlarge");
      const t = num(sb.file(`launched-${n}`));
      expect(t).toBeGreaterThanOrEqual(before);
      expect(t).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    }
    const first = Math.min(...[1, 2, 3].map((n) => num(sb.file(`launched-${n}`))));
    expect(num(sb.file("charged"))).toBe(first);
    expect(sb.file("sg.conf").trim()).toBe("SG=sg-0001");
    expect(sb.state().sgs["sg-0001"].rules).toEqual(["203.0.113.7/32"]);
    expect(Object.keys(sb.state().keypairs)).toEqual(["bl-scaf-hunt1"]);
    expect(liveInstances()).toHaveLength(3);
  });

  /** The user-data the fake EC2 holds for instance n. */
  const userData = (n: number): string => sb.state().instances[sb.file(`instance-${n}`).trim()].userdata as string;
  const armed = (deadline: number): string => `#!/bin/bash\necho ${deadline} > /etc/bl-deadline\nprintf x > /etc/cron.d/bl-deadline\n/sbin/shutdown -h +780\n`;

  it("launches every instance with shutdown behaviour terminate and the deadline user-data (launch + 13 h), and records the deadline", () => {
    expect(launch().status).toBe(0);
    for (const n of [1, 2, 3]) {
      const id = sb.file(`instance-${n}`).trim();
      expect(sb.state().instances[id].shutdown).toBe("terminate");
      expect(num(sb.file(`deadline-${n}`))).toBe(num(sb.file(`launched-${n}`)) + 13 * 3600);
      expect(userData(n)).toContain(`echo ${num(sb.file(`deadline-${n}`))} > /etc/bl-deadline\n`);
    }
    const runs = sb.calls("run-instances");
    expect(runs).toHaveLength(3);
    for (const l of runs) {
      expect(l).toContain("--instance-initiated-shutdown-behavior terminate");
      expect(l).not.toContain("shutdown-behavior stop");
      expect(l).toMatch(/--user-data file:\/\/\S+\/pending-\d\.ud/);
    }
  });

  describe("the user-data (cloud-init, at first boot, before any bootstrap)", () => {
    /** Runs the user-data as written, with / paths moved into a scratch root, shutdown a logger and the clock of the instance as given. */
    const runUserData = (text: string): { root: string; shutdowns: string[]; check: (deadline: number) => string[] } => {
      const root = mkdtempSync(join(tmpdir(), "hunt1-ud-"));
      roots.push(root);
      for (const d of ["etc/cron.d", "usr/local/sbin"]) mkdirSync(join(root, d), { recursive: true });
      const fakeShutdown = join(root, "shutdown");
      writeFileSync(fakeShutdown, SH(`echo "$@" >> "${root}/shutdown.log"`));
      chmodSync(fakeShutdown, 0o755);
      const moved = text.replaceAll("/etc/cron.d/", `${root}/etc/cron.d/`).replaceAll("/etc/bl-deadline", `${root}/etc/bl-deadline`).replaceAll("/usr/local/sbin/", `${root}/usr/local/sbin/`).replaceAll("/sbin/shutdown", fakeShutdown);
      writeFileSync(join(root, "userdata.sh"), moved);
      const r = spawnSync("/bin/bash", [join(root, "userdata.sh")], { encoding: "utf8" });
      expect(r.status, r.stderr).toBe(0);
      const log = () => tryRead(join(root, "shutdown.log")).split("\n").filter(Boolean);
      return {
        root,
        shutdowns: log(),
        // the cron job's check script against a deadline of the test's choosing
        check: (deadline) => {
          writeFileSync(join(root, "etc/bl-deadline"), `${deadline}\n`);
          rmSync(join(root, "shutdown.log"), { force: true });
          expect(spawnSync("/bin/bash", [join(root, "usr/local/sbin/bl-deadline-check")], { encoding: "utf8" }).stderr).toBe("");
          return log();
        },
      };
    };

    it("writes launch + 13 h to /etc/bl-deadline, a root cron every minute and at reboot, and schedules the shutdown for the remaining minutes", () => {
      expect(launch().status).toBe(0);
      const text = userData(1);
      const deadline = num(sb.file("deadline-1"));
      expect(text.startsWith("#!/bin/bash\n")).toBe(true);
      expect(text).toContain(`echo ${deadline} > /etc/bl-deadline\n`);
      expect(text).toContain("* * * * * root /usr/local/sbin/bl-deadline-check");
      expect(text).toContain("@reboot root /usr/local/sbin/bl-deadline-check");
      expect(text).toContain("/etc/cron.d/bl-deadline");
      const u = runUserData(text);
      expect(readFileSync(join(u.root, "etc/bl-deadline"), "utf8").trim()).toBe(String(deadline));
      const cron = readFileSync(join(u.root, "etc/cron.d/bl-deadline"), "utf8").split("\n").filter(Boolean);
      expect(cron.filter((l) => l.startsWith("* * * * * root ") || l.startsWith("@reboot root "))).toHaveLength(2);
      expect(cron[0]).toMatch(/^PATH=.*\/sbin/);
      // the remaining time at first boot: about 13 h = 780 minutes (rounded up), scheduled at once
      expect(u.shutdowns).toEqual(["-h +780"]);
    });

    it("the cron's check shuts the instance down once the clock reaches the deadline, and not before", () => {
      expect(launch().status).toBe(0);
      const u = runUserData(userData(1));
      const now = Math.floor(Date.now() / 1000);
      expect(u.check(now + 3600)).toEqual([]);
      expect(u.check(now + 1)).toEqual([]);
      expect(u.check(now)).toEqual(["-h now"]);
      expect(u.check(now - 86_400)).toEqual(["-h now"]);
    });

    it("shuts down at once when the deadline has already passed at first boot", () => {
      expect(launch().status).toBe(0);
      const text = userData(1).replaceAll(String(num(sb.file("deadline-1"))), String(Math.floor(Date.now() / 1000) - 600));
      expect(runUserData(text).shutdowns).toEqual(["-h now"]);
    });
  });

  it("fails closed: a refused user-data stops the launch, nothing is launched without it", () => {
    sb.inject({ op: "run-instances", mode: "error:InvalidUserData.Malformed", times: -1 });
    const r = launch();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("deadline user-data was refused");
    expect(Object.keys(sb.state().instances)).toHaveLength(0);
    const runs = sb.calls("run-instances");
    expect(runs).toHaveLength(1);
    expect(runs.every((l) => l.includes("--user-data"))).toBe(true);
    expect(sb.has("instance-1")).toBe(false);
  });

  it("fails closed: a launched instance that does not carry the user-data is terminated and not recorded", () => {
    sb.inject({ op: "run-instances", mode: "drop-userdata", times: 1 });
    const r = launch();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("does not carry the deadline user-data");
    expect(sb.calls("wait")).toHaveLength(1);   // the termination was waited for
    expect(Object.values(sb.state().instances).filter((i) => (i as { state: string }).state !== "terminated")).toHaveLength(0);
    expect(sb.has("instance-1")).toBe(false);
    expect(sb.has("instance-2")).toBe(false);
  });

  it("is idempotent: a second run keeps the key, the key pair, the group, the instances, the deadlines and the ledger", () => {
    expect(launch().status).toBe(0);
    const key = sb.file("bl_key"), pub = sb.file("bl_key.pub"), charged = sb.file("charged"), ids = [1, 2, 3].map((n) => sb.file(`instance-${n}`)), deadlines = [1, 2, 3].map((n) => sb.file(`deadline-${n}`));
    const r = launch();
    expect(r.status, r.stderr).toBe(0);
    expect([1, 2, 3].map((n) => sb.file(`deadline-${n}`))).toEqual(deadlines);
    expect(sb.file("bl_key")).toBe(key);
    expect(sb.file("bl_key.pub")).toBe(pub);
    expect(sb.file("charged")).toBe(charged);
    expect([1, 2, 3].map((n) => sb.file(`instance-${n}`))).toEqual(ids);
    expect(sb.calls("import-key-pair")).toHaveLength(1);
    expect(sb.calls("create-security-group")).toHaveLength(1);
    expect(sb.calls("run-instances")).toHaveLength(3);
    expect(Object.keys(sb.state().instances)).toHaveLength(3);
  });

  it("never overwrites an existing bl_key, and imports it when AWS has no key pair", () => {
    spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "mine", "-f", join(sb.ops, "bl_key")]);
    const key = sb.file("bl_key"), pub = sb.file("bl_key.pub");
    expect(launch().status).toBe(0);
    expect(sb.file("bl_key")).toBe(key);
    expect(sb.file("bl_key.pub")).toBe(pub);
    expect(sb.calls("import-key-pair")).toHaveLength(1);
  });

  it("derives a missing bl_key.pub from the private key, and refuses a lone public key", () => {
    spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", join(sb.ops, "bl_key")]);
    const key = sb.file("bl_key");
    rmSync(join(sb.ops, "bl_key.pub"));
    expect(launch().status).toBe(0);
    expect(sb.file("bl_key")).toBe(key);
    expect(sb.has("bl_key.pub")).toBe(true);
    const sb2 = mkSandbox();
    sb2.install("launch.sh");
    writeFileSync(join(sb2.ops, "bl_key.pub"), "ssh-ed25519 AAAA x\n");
    const r = sb2.run(join(sb2.ops, "launch.sh"), [], { LAUNCH_PAUSE: "0" }, { cwd: sb2.ops });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("bl_key.pub exists without bl_key");
    expect(sb2.has("bl_key")).toBe(false);
  });

  it("reuses an AWS key pair whose fingerprint matches (either format) and stops on one that does not", () => {
    const fingerprint = (pubFile: string, style: "padded" | "prefixed"): string => {
      const d = createHash("sha256").update(Buffer.from(readFileSync(pubFile, "utf8").split(/\s+/)[1], "base64")).digest("base64");
      return style === "prefixed" ? `SHA256:${d.replace(/=+$/, "")}` : d;
    };
    for (const style of ["padded", "prefixed"] as const) {
      const box = mkSandbox();
      box.install("launch.sh");
      spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", join(box.ops, "bl_key")]);
      const key = readFileSync(join(box.ops, "bl_key"), "utf8");
      box.edit((st) => (st.keypairs["bl-scaf-hunt1"] = { fp: fingerprint(join(box.ops, "bl_key.pub"), style) }));
      const r = box.run(join(box.ops, "launch.sh"), [], { LAUNCH_PAUSE: "0" }, { cwd: box.ops });
      expect(r.status, `${style}: ${r.stderr}`).toBe(0);
      expect(r.stdout).toContain("reusing it");
      expect(box.calls("import-key-pair"), style).toHaveLength(0);
      expect(readFileSync(join(box.ops, "bl_key"), "utf8")).toBe(key);
    }
    // a key pair of the same name with another fingerprint: stop, touch nothing
    const box = mkSandbox();
    box.install("launch.sh");
    spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", join(box.ops, "bl_key")]);
    const key = readFileSync(join(box.ops, "bl_key"), "utf8");
    box.edit((st) => (st.keypairs["bl-scaf-hunt1"] = { fp: "AAAAotherfingerprint" }));
    const r = box.run(join(box.ops, "launch.sh"), [], { LAUNCH_PAUSE: "0" }, { cwd: box.ops });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("fingerprint");
    expect(readFileSync(join(box.ops, "bl_key"), "utf8")).toBe(key);
    expect(box.calls("run-instances")).toHaveLength(0);
    expect(box.calls("import-key-pair")).toHaveLength(0);
    expect(box.calls("delete-key-pair")).toHaveLength(0);
  });

  it("stops when the key pair exists but the local key does not, without generating one", () => {
    sb.edit((s) => (s.keypairs["bl-scaf-hunt1"] = { fp: "AAAA" }));
    const r = launch();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("no local bl_key");
    expect(sb.has("bl_key")).toBe(false);
    expect(sb.calls("run-instances")).toHaveLength(0);
  });

  it("reuses the security group of sg.conf, or the one found by name, and never creates a second", () => {
    sb.edit((s) => (s.sgs["sg-0077"] = { name: "bl-scaf-hunt1", vpc: "vpc-7f9d051a", rules: [] }));
    writeFileSync(join(sb.ops, "sg.conf"), "SG=sg-0077\n");
    expect(launch().status).toBe(0);
    expect(sb.file("sg.conf").trim()).toBe("SG=sg-0077");
    expect(sb.calls("create-security-group")).toHaveLength(0);
    expect(sb.state().sgs["sg-0077"].rules).toEqual(["203.0.113.7/32"]);
    // by name, with no sg.conf (or a recorded group that is gone)
    const sb2 = mkSandbox();
    sb2.install("launch.sh");
    sb2.edit((s) => (s.sgs["sg-0088"] = { name: "bl-scaf-hunt1", vpc: "vpc-7f9d051a", rules: [] }));
    writeFileSync(join(sb2.ops, "sg.conf"), "SG=sg-0001\n");
    expect(sb2.run(join(sb2.ops, "launch.sh"), [], { LAUNCH_PAUSE: "0" }, { cwd: sb2.ops }).status).toBe(0);
    expect(sb2.file("sg.conf").trim()).toBe("SG=sg-0088");
    expect(sb2.calls("create-security-group")).toHaveLength(0);
  });

  it("falls back to g6.xlarge when g5 has no capacity", () => {
    sb.inject({ op: "run-instances", mode: "error:InsufficientInstanceCapacity", match: "g5.xlarge", times: -1 });
    const r = launch();
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect([1, 2, 3].map((n) => sb.file(`type-${n}`).trim())).toEqual(["g6.xlarge", "g6.xlarge", "g6.xlarge"]);
  });

  it("repeats an uncertain launch with the same client token and never launches a second instance", () => {
    // the first response is lost after the instance was created
    sb.inject({ op: "run-instances", mode: "created-then-timeout", times: 1 });
    const r = launch();
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(Object.keys(sb.state().instances)).toHaveLength(3);
    const tokens = sb.calls("run-instances").map((l) => l.match(/--client-token (\S+)/)![1]);
    expect(tokens[0]).toBe(tokens[1]);
    expect(new Set(tokens).size).toBe(3);
  });

  it("adopts an instance it cannot get a response for by its tag, instead of launching another", () => {
    // all three same-token repeats of instance 1 time out (the instance exists); the tag lookup finds it
    sb.inject({ op: "run-instances", mode: "created-then-timeout", times: 3 });
    const r = launch();
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(Object.keys(sb.state().instances)).toHaveLength(3);
    const id = sb.file("instance-1").trim();
    expect(sb.state().instances[id].name).toBe("bl-scaf-hunt1-1");
  });

  it("stops, without launching blind, when the outcome stays unknown", () => {
    sb.inject({ op: "run-instances", mode: "timeout", times: -1 });
    const r = launch();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("outcome of the launch is unknown");
    expect(sb.has("pending-1")).toBe(true);
    expect(Object.keys(sb.state().instances)).toHaveLength(0);
    expect(sb.has("instance-2")).toBe(false);
  });

  describe("a request whose outcome is unknown is persisted and replayed unchanged on every later invocation", () => {
    const liveCount = () => Object.values(sb.state().instances).filter((i) => (i as { state: string }).state !== "terminated").length;
    /** Run 1: slot 1's request creates its instance but every response is lost; the lookups named in `hide` do not see it. */
    const lostRun = (hide: { match: string; times?: number }[]) => {
      sb.inject({ op: "run-instances", mode: "created-then-timeout", times: -1 }, ...hide.map((h) => ({ op: "describe-instances", mode: "empty", match: h.match, times: h.times ?? -1 })));
      return launch();
    };
    const tokens = (): string[] => sb.calls("run-instances").map((l) => l.match(/--client-token (\S+)/)![1]);

    it("persists the whole request before submitting it, and replays it unchanged (token, deadline, user-data) without launching a second instance", () => {
      // nothing sees the instance: not the tag, the token or the key pair
      const r1 = lostRun([{ match: "bl-scaf-hunt1-1" }, { match: "client-token" }, { match: "key-name" }]);
      expect(r1.status).toBe(1);
      expect(sb.has("pending-1")).toBe(true);
      const pending = sb.file("pending-1"), ud = sb.file("pending-1.ud");
      expect(pending).toMatch(/^deadline=\d+\ntoken=bl-hunt1-\S+\ntype=g5\.xlarge\nsubnet=subnet-aaa\nudhash=\S+\n$/);
      expect(Object.keys(sb.state().instances)).toHaveLength(1);
      const first = tokens();
      expect(new Set(first).size).toBe(1);
      // run 2: the request returns the same instance; the lookups still lag
      sb.edit((st) => (st.inject = []));
      sb.inject({ op: "describe-instances", mode: "empty", match: "bl-scaf-hunt1-1", times: -1 }, { op: "describe-instances", mode: "empty", match: "client-token", times: -1 });
      const r2 = launch();
      expect(r2.status, r2.stderr + r2.stdout).toBe(0);
      expect(r2.stdout).toContain("replaying its pending request");
      expect(tokens().slice(first.length)[0]).toBe(first[0]);
      expect(sb.file("instance-1").trim()).toBe(Object.keys(sb.state().instances)[0]);
      expect(sb.has("pending-1")).toBe(false);
      expect(liveCount()).toBe(3);
      expect(userData(1)).toBe(ud);
      expect(userData(1)).toContain(`echo ${pending.match(/deadline=(\d+)/)![1]} > /etc/bl-deadline`);
      expect(num(sb.file("deadline-1"))).toBe(Number(pending.match(/deadline=(\d+)/)![1]));
    });

    it("reconciles by client token before any new submission when the tag lookup misses", () => {
      expect(lostRun([{ match: "bl-scaf-hunt1-1" }, { match: "client-token" }, { match: "key-name" }]).status).toBe(1);
      const submitted = sb.calls("run-instances").length;
      sb.edit((st) => (st.inject = []));
      sb.inject({ op: "describe-instances", mode: "empty", match: "Name=tag:Name,Values=bl-scaf-hunt1-1", times: -1 });
      const r2 = launch();
      expect(r2.status, r2.stderr + r2.stdout).toBe(0);
      expect(r2.stdout).toContain("adopted");
      // slot 1 was adopted by token: only slots 2 and 3 submitted anything
      expect(sb.calls("run-instances").length - submitted).toBe(2);
      expect(liveCount()).toBe(3);
      expect(sb.has("pending-1")).toBe(false);
    });

    it("the final sweep looks for a pending request's instance by client token once more", () => {
      // the first three token lookups (the polls after the lost responses) miss; the sweep's sees it
      const r1 = lostRun([{ match: "Name=tag:Name,Values=bl-scaf-hunt1-1" }, { match: "key-name" }, { match: "client-token", times: 3 }]);
      expect(r1.status, r1.stdout + r1.stderr).toBe(1);
      expect(sb.has("pending-1")).toBe(false);
      expect(sb.file("instance-1").trim()).toBe(Object.keys(sb.state().instances)[0]);
      expect(liveCount()).toBe(1);
    });

    it("a replay that returns an instance the final sweep terminated is dropped and a new request is made", () => {
      // hidden from the tag and token lookups, visible to the key-pair sweep, which terminates it
      expect(lostRun([{ match: "bl-scaf-hunt1-1" }, { match: "client-token" }]).status).toBe(1);
      const dead = Object.keys(sb.state().instances)[0];
      expect(sb.state().instances[dead].state).toBe("terminated");
      expect(sb.has("pending-1")).toBe(true);
      const old = sb.file("pending-1");
      sb.edit((st) => (st.inject = []));
      const r2 = launch();
      expect(r2.status, r2.stderr + r2.stdout).toBe(0);
      expect(r2.stdout).toContain("already terminated; starting a new request");
      expect(sb.file("instance-1").trim()).not.toBe(dead);
      expect(sb.has("pending-1")).toBe(false);
      expect(old).toContain("token=");
      expect(liveCount()).toBe(3);
    });

    it("drops a pending request whose deadline has passed, and starts a new one", () => {
      writeFileSync(join(sb.ops, "launch-nonce"), "deadbeef");
      writeFileSync(join(sb.ops, "pending-1.ud"), armed(1_000_000_000));
      writeFileSync(join(sb.ops, "pending-1"), `deadline=1000000000\ntoken=bl-hunt1-deadbeef-1-1\ntype=g5.xlarge\nsubnet=subnet-aaa\nudhash=${spawnSync("bash", ["-c", "cksum < pending-1.ud | tr ' ' -"], { cwd: sb.ops, encoding: "utf8" }).stdout.trim()}\n`);
      const r = launch();
      expect(r.status, r.stderr + r.stdout).toBe(0);
      expect(r.stdout).toContain("deadline has passed");
      expect(tokens().every((t) => t !== "bl-hunt1-deadbeef-1-1")).toBe(true);
      expect(liveCount()).toBe(3);
    });

    it("refuses to replay a pending request whose user-data no longer matches its hash", () => {
      writeFileSync(join(sb.ops, "launch-nonce"), "deadbeef");
      writeFileSync(join(sb.ops, "pending-1.ud"), armed(Math.floor(Date.now() / 1000) + 3600));
      writeFileSync(join(sb.ops, "pending-1"), `deadline=${Math.floor(Date.now() / 1000) + 3600}\ntoken=bl-hunt1-deadbeef-1-1\ntype=g5.xlarge\nsubnet=subnet-aaa\nudhash=1-1\n`);
      const r = launch();
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("does not match its recorded hash");
      expect(sb.calls("run-instances")).toHaveLength(0);
    });
  });

  describe("one launch.sh at a time (an OS-held lock)", () => {
    it("exits at once while another process holds launch.lock, and runs once that holder has died: the kernel released the lock, no lock file is ever deleted", () => {
      const lockFile = join(sb.ops, "launch.lock");
      const holder = holdLock(lockFile);
      const inode = statSync(lockFile).ino;
      try {
        const r = launch();
        expect(r.status).toBe(1);
        expect(r.stderr).toContain("another launch.sh holds launch.lock");
        expect(sb.fakeLog("calls.log")).toEqual([]);
        expect(statSync(lockFile).ino).toBe(inode);
      } finally {
        holder.kill();
      }
      expect(launch().status).toBe(0);
      expect(existsSync(lockFile)).toBe(true);
      expect(statSync(lockFile).ino).toBe(inode);
    });

    it("two launch.sh at once: only one proceeds, and nothing is launched twice", async () => {
      const first = new Promise<number | null>((res) => spawn("/bin/bash", [join(sb.ops, "launch.sh")], { env: sb.env({ LAUNCH_PAUSE: "0", CURL_DELAY: "3" }), cwd: sb.ops, stdio: "ignore" }).on("close", res));
      spawnSync("sleep", ["1"]);
      const second = launch();
      expect(second.status).toBe(1);
      expect(second.stderr).toContain("another launch.sh holds launch.lock");
      expect(await first).toBe(0);
      expect(sb.calls("run-instances")).toHaveLength(3);
      expect(Object.keys(sb.state().instances)).toHaveLength(3);
    });
  });

  it("adopts an existing instance tagged for its slot (with its launch time), and does not launch it again", () => {
    const hourAgo = new Date(Date.now() - 3600_000).toISOString().replace(/\.\d+Z$/, "+00:00");
    const deadline = Math.floor(Date.now() / 1000) + 13 * 3600;
    sb.edit((s) => (s.instances["i-00000000000000aa"] = { name: "bl-scaf-hunt1-2", state: "running", type: "g6.xlarge", key: "bl-scaf-hunt1", launch: hourAgo, ip: "10.0.0.2", userdata: armed(deadline) }));
    const r = launch();
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(sb.file("instance-2").trim()).toBe("i-00000000000000aa");
    expect(num(sb.file("deadline-2"))).toBe(deadline);
    expect(sb.file("type-2").trim()).toBe("g6.xlarge");
    expect(Math.abs(num(sb.file("launched-2")) - (Math.floor(Date.now() / 1000) - 3600))).toBeLessThan(5);
    expect(num(sb.file("charged"))).toBe(num(sb.file("launched-2")));
    expect(Object.keys(sb.state().instances)).toHaveLength(3);
    expect(sb.calls("run-instances")).toHaveLength(2);
  });

  it("terminates an adopted candidate that has no deadline user-data, and launches the slot afresh", () => {
    sb.edit((s) => (s.instances["i-00000000000000dd"] = { name: "bl-scaf-hunt1-1", state: "running", type: "g5.xlarge", key: "bl-scaf-hunt1", launch: "2026-10-03T00:00:00+00:00", ip: "10.0.0.1", userdata: null }));
    const r = launch();
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(sb.state().instances["i-00000000000000dd"].state).toBe("terminated");
    expect(sb.file("instance-1").trim()).not.toBe("i-00000000000000dd");
    expect(userData(1)).toContain("/etc/bl-deadline");
  });

  it("refuses to keep a recorded instance that carries no deadline", () => {
    sb.edit((s) => (s.instances["i-00000000000000ee"] = { name: "bl-scaf-hunt1-1", state: "running", type: "g5.xlarge", key: "bl-scaf-hunt1", launch: "2026-10-03T00:00:00+00:00", ip: "10.0.0.1", userdata: null }));
    writeFileSync(join(sb.ops, "instance-1"), "i-00000000000000ee\n");
    writeFileSync(join(sb.ops, "launched-1"), "1790000000\n");
    const r = launch();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("carried no deadline");
    expect(sb.state().instances["i-00000000000000ee"].state).toBe("terminated");
  });

  it("terminates an instance under the key pair that no instance-N file records", () => {
    sb.edit((s) => (s.instances["i-00000000000000bb"] = { name: "stray", state: "running", type: "g5.xlarge", key: "bl-scaf-hunt1", launch: "2026-10-03T00:00:00+00:00", ip: "10.0.0.9" }));
    const r = launch();
    expect(r.stdout).toContain("untracked instance i-00000000000000bb");
    expect(sb.state().instances["i-00000000000000bb"].state).toBe("terminated");
    expect(liveInstances()).toHaveLength(3);
    expect(r.status).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// supervise.sh

describeOps("supervise.sh", () => {
  let sb: Sandbox;
  const ID = (n: number) => `i-${String(n).padStart(17, "0")}`;
  const nowS = () => Math.floor(Date.now() / 1000);
  const CMDS = (n: number) => [`devcheck-${n}|-|bash ops/devcheck.sh`, `h-a-${n}|devcheck-${n}|bash ops/history.sh hist pond-nat ${n}`, `h-b-${n}|devcheck-${n}|bash ops/history.sh hist pond-shuf ${n}`];
  const remote = (n: number) => join(sb.fake, "remote", `10.0.0.${n}`);
  /** A fake instance n: its home with the queue state; `ended` commands done (all by default), `finished` marks it. */
  const mkRemote = (n: number, o: { finished?: boolean; done?: string[]; fail?: string[]; extra?: string[] } = {}) => {
    const h = join(remote(n), "bl");
    for (const d of ["ops/done", "ops/fail", "ops/logs", `runs/scaffold/hunt1/device/ponds/pond-nat/seed-4905001`, `runs/scaffold/hunt1/hist/ponds/pond-nat/seed-${n}`]) mkdirSync(join(h, d), { recursive: true });
    writeFileSync(join(h, "ops/instance"), `${n}\n`);
    writeFileSync(join(h, "ops/cmds.txt"), CMDS(n).join("\n") + "\n");
    writeFileSync(join(h, "ops/lanes.log"), "lane1 start\n");
    writeFileSync(join(h, `runs/scaffold/hunt1/device/ponds/pond-nat/seed-4905001/manifest.json`), "{}");
    writeFileSync(join(h, `runs/scaffold/hunt1/hist/ponds/pond-nat/seed-${n}/ponds.tsv`), `rows of ${n}\n`);
    const ids = CMDS(n).map((l) => l.split("|")[0]);
    for (const id of o.done ?? ids) writeFileSync(join(h, "ops/done", id), "");
    for (const id of o.fail ?? []) writeFileSync(join(h, "ops/fail", id), "rc=1");
    if (o.finished ?? true) writeFileSync(join(h, "ops/finished"), "1\n");
    for (const rel of o.extra ?? []) {
      mkdirSync(dirname(join(h, rel)), { recursive: true });
      writeFileSync(join(h, rel), `${rel} of ${n}\n`);
    }
  };
  /** Instances 1-3 running, launched an hour ago with the ledger starting then. */
  beforeEach(() => {
    sb = mkSandbox();
    sb.install("supervise.sh");
    for (const n of [1, 2, 3]) {
      writeFileSync(join(sb.ops, `instance-${n}`), ID(n) + "\n");
      writeFileSync(join(sb.ops, `launched-${n}`), String(nowS() - 3600));
      writeFileSync(join(sb.ops, `deadline-${n}`), String(nowS() - 3600 + 13 * 3600));
      writeFileSync(join(sb.ops, `cmds-${n}.txt`), CMDS(n).join("\n") + "\n");
    }
    writeFileSync(join(sb.ops, "charged"), String(nowS() - 3600));
    writeFileSync(join(sb.ops, "sg.conf"), "SG=sg-0001\n");
    mkdirSync(join(sb.home, "Library", "LaunchAgents"), { recursive: true });
    writeFileSync(join(sb.home, "Library", "LaunchAgents", "com.browser-life.scaf-hunt1.plist"), "<plist/>");
    sb.edit((s) => {
      s.keypairs["bl-scaf-hunt1"] = { fp: "x" };
      s.sgs["sg-0001"] = { name: "bl-scaf-hunt1", vpc: "vpc-7f9d051a", rules: [] };
      for (const n of [1, 2, 3]) s.instances[ID(n)] = { name: `bl-scaf-hunt1-${n}`, state: "running", type: "g5.xlarge", key: "bl-scaf-hunt1", launch: "2026-10-03T00:00:00+00:00", ip: `10.0.0.${n}` };
    });
  });
  const pass = (extra: Record<string, string> = {}) => sb.run(join(sb.ops, "supervise.sh"), [], { RETRY_PAUSE: "0", ...extra });
  const cost = () => num(sb.file("cost"));
  const setCost = (v: number) => writeFileSync(join(sb.ops, "cost"), String(v));
  const log = () => tryRead(join(sb.ops, "supervise.log"));
  const status = () => tryRead(join(sb.ops, "STATUS"));
  const compute = (hours: number, instances: number) => instances * 1.006 * hours + (3 * 150 * 0.08 * hours) / 730;
  /** The deadline of every instance, in seconds from now (negative: passed, nothing left to reserve). */
  const deadlinesIn = (secs: number) => {
    for (const n of [1, 2, 3]) writeFileSync(join(sb.ops, `deadline-${n}`), String(nowS() + secs));
  };
  const reserveShown = (): number => Number(status().match(/reserve=\$([\d.]+)/)![1]);

  it("charges compute and volumes from the recorded launch time on the first pass", () => {
    for (const n of [1, 2, 3]) mkRemote(n, { finished: false, done: [] });
    expect(pass().status, log()).toBe(0);
    expect(cost()).toBeGreaterThan(compute(1, 3) - 0.02);
    expect(cost()).toBeLessThan(compute(1, 3) + 0.2);
    expect(status()).toMatch(/^cost=\$3\.\d+\/48 /);
  });

  it("checks the budget before any transfer: a pass that crosses $46 tears down without a single ssh or rsync", () => {
    for (const n of [1, 2, 3]) mkRemote(n, { finished: false, done: [] });
    writeFileSync(join(sb.ops, "charged"), String(nowS() - 360));
    setCost(45.9);
    expect(pass().status, log()).toBe(0);
    expect(sb.fakeLog("ssh.log")).toEqual([]);
    expect(sb.fakeLog("rsync.log")).toEqual([]);
    expect(sb.has("budget-stopped")).toBe(true);
    expect(sb.has("done")).toBe(true);
    expect(status()).toContain("DONE");
    expect(status()).toContain("budget spent");
    expect(Object.values(sb.state().instances).every((i) => (i as { state: string }).state === "terminated")).toBe(true);
    expect(Object.keys(sb.state().keypairs)).toEqual([]);
    expect(Object.keys(sb.state().sgs)).toEqual([]);
    expect(sb.fakeLog("launchctl.log")).toHaveLength(1);
    expect(existsSync(join(sb.home, "Library", "LaunchAgents", "com.browser-life.scaf-hunt1.plist"))).toBe(false);
  });

  describe("the reserve: the ledger plus what the live instances can still cost to their deadlines (plus the next transfer) stays under CAP - 2", () => {
    it("at launch the reserve is about 13 h x 3 x $1.006 plus the volumes, $39.9, and one more transfer fits", () => {
      for (const n of [1, 2, 3]) mkRemote(n, { finished: false, done: [] });
      writeFileSync(join(sb.ops, "charged"), String(nowS()));
      deadlinesIn(13 * 3600);
      expect(pass().status, log()).toBe(0);
      // 13 x 3 x (1.006 + 150 x 0.08 / 730) = 39.875, a few seconds of it already gone
      expect(reserveShown()).toBeGreaterThan(39.8);
      expect(reserveShown()).toBeLessThan(39.88);
      expect(sb.has("budget-stopped")).toBe(false);
      expect(sb.fakeLog("rsync.log").length).toBeGreaterThan(0);
    });

    it("tears down before any transfer once the ledger plus the reserve crosses $46, though the ledger alone is far below it", () => {
      for (const n of [1, 2, 3]) mkRemote(n, { finished: false, done: [] });
      writeFileSync(join(sb.ops, "charged"), String(nowS()));
      deadlinesIn(13 * 3600);
      setCost(6.5);   // 6.5 + 39.875 = 46.4
      expect(pass().status, log()).toBe(0);
      expect(sb.fakeLog("ssh.log")).toEqual([]);
      expect(sb.fakeLog("rsync.log")).toEqual([]);
      expect(sb.has("budget-stopped")).toBe(true);
      expect(sb.has("done")).toBe(true);
      expect(status()).toContain("budget spent: ledger $6.5");
      expect(Object.values(sb.state().instances).every((i) => (i as { state: string }).state === "terminated")).toBe(true);
      expect(sb.calls("terminate-instances")).toHaveLength(3);
    });

    it("the next transfer's maximum counts: room for one transfer lets the pass transfer, a cent less does not", () => {
      for (const n of [1, 2, 3]) mkRemote(n, { finished: false, done: [] });
      writeFileSync(join(sb.ops, "charged"), String(nowS()));
      deadlinesIn(3600);   // an hour left: reserve 3 x 1.0224 = 3.07; one transfer at 20,000 KB/s for 360 s is $0.66
      setCost(42.0);       // 42.0 + 3.07 + 0.66 = 45.73 < 46
      expect(pass().status, log()).toBe(0);
      expect(sb.fakeLog("rsync.log").length).toBeGreaterThan(0);
      expect(sb.has("done")).toBe(false);
    });

    it("refuses the first transfer when the ledger, the reserve and a transfer reach the stop together, and tears down", () => {
      for (const n of [1, 2, 3]) mkRemote(n, { finished: false, done: [] });
      writeFileSync(join(sb.ops, "charged"), String(nowS()));
      deadlinesIn(3600);
      setCost(42.4);       // 42.4 + 3.07 = 45.47 passes the early check; + 0.66 = 46.13 does not pass a transfer
      expect(pass().status, log()).toBe(0);
      expect(sb.fakeLog("ssh.log")).toEqual([]);
      expect(sb.fakeLog("rsync.log")).toEqual([]);
      expect(log()).toContain("has reached the stop; no more transfers this pass");
      expect(sb.has("budget-stopped")).toBe(true);
      expect(sb.has("done")).toBe(true);
    });

    it("an instance that has terminated reserves nothing; one past its deadline reserves nothing", () => {
      for (const n of [1, 2, 3]) mkRemote(n, { finished: false, done: [] });
      writeFileSync(join(sb.ops, "charged"), String(nowS()));
      deadlinesIn(13 * 3600);
      sb.edit((st) => (st.instances[ID(1)].state = "terminated"));
      writeFileSync(join(sb.ops, "deadline-2"), String(nowS() - 5));
      expect(pass().status, log()).toBe(0);
      // only instance 3 is left: 13 h
      expect(reserveShown()).toBeGreaterThan(13 * 1.022438 - 0.05);
      expect(reserveShown()).toBeLessThan(13 * 1.022438 + 0.01);
    });
  });

  it("charges a running-to-stopped transition for the pass in which it happened, once", () => {
    for (const n of [1, 2, 3]) mkRemote(n, { finished: false, done: [] });
    writeFileSync(join(sb.ops, "final-1"), "");
    sb.edit((s) => (s.instances[ID(1)].state = "stopped"));
    expect(pass().status, log()).toBe(0);
    const c1 = cost();
    expect(c1).toBeGreaterThan(compute(1, 3) - 0.02);
    expect(sb.file("state-1").trim()).toBe("stopped");
    writeFileSync(join(sb.ops, "charged"), String(nowS() - 3600));
    expect(pass().status, log()).toBe(0);
    expect(cost() - c1).toBeGreaterThan(compute(1, 2) - 0.02);
    expect(cost() - c1).toBeLessThan(compute(1, 2) + 0.2);
  });

  it("charges an instance whose state it cannot read as running", () => {
    for (const n of [1, 2, 3]) mkRemote(n, { finished: false, done: [] });
    sb.inject({ op: "describe-instances", mode: "timeout", match: `--instance-ids ${ID(1)} --query`, times: -1 });
    expect(pass().status, log()).toBe(0);
    expect(cost()).toBeGreaterThan(compute(1, 3) - 0.02);
    expect(sb.file("state-1").trim()).toBe("unknown");
    expect(status()).toContain("i1=unknown");
  });

  it("charges an instance under the key pair that no file records, and leaves it for teardown", () => {
    for (const n of [1, 2, 3]) mkRemote(n, { finished: false, done: [] });
    sb.edit((s) => (s.instances["i-00000000000000cc"] = { name: "stray", state: "running", type: "g5.xlarge", key: "bl-scaf-hunt1", launch: "2026-10-03T00:00:00+00:00", ip: "10.0.0.9" }));
    deadlinesIn(-10);   // the tracked ones have nothing left to reserve; the untracked one is reserved a full 13 h
    expect(pass().status, log()).toBe(0);
    expect(cost()).toBeGreaterThan(compute(1, 4) - 0.02);
    expect(reserveShown()).toBeGreaterThan(13 * (1.006 + 0.016438) - 0.01);
    expect(reserveShown()).toBeLessThan(13 * (1.006 + 0.016438) + 0.01);
    expect(status()).toContain("untracked: i-00000000000000cc");
    expect(sb.state().instances["i-00000000000000cc"].state).toBe("running");
  });

  it("charges every transfer's egress: the bytes it reports when it finished, the most the bandwidth limit allows for the time it ran when it failed", () => {
    for (const n of [1, 2, 3]) mkRemote(n, { finished: false, done: [] });
    // the main pulls of the three instances report 5 GB each ($0.45); the other transfers report their real, tiny size
    sb.rsyncRules([{ match: "bl/runs/scaffold/hunt1/", end: true, received: 5_000_000_000 }]);
    writeFileSync(join(sb.ops, "charged"), String(nowS()));
    expect(pass().status, log()).toBe(0);
    expect(cost()).toBeGreaterThan(3 * 5 * 0.09 - 0.01);
    expect(cost()).toBeLessThan(3 * 5 * 0.09 + 0.1);
    // a failed transfer reports nothing: BWLIMIT x 1024 bytes for each second it ran (1-2 s here); 100 MB/s makes that visible
    sb.clearRules();
    sb.rsyncRules([{ match: "device/", rc: 30 }]);
    writeFileSync(join(sb.ops, "charged"), String(nowS()));
    const before = cost();
    expect(pass({ BWLIMIT_KB: "100000", PASS_LIMIT: "20" }).status, log()).toBe(0);
    const perSecond = (100_000 * 1024 * 0.09) / 1e9;
    expect(cost() - before).toBeGreaterThan(3 * perSecond - 0.005);
    expect(cost() - before).toBeLessThan(3 * 2 * perSecond + 0.05);
  });

  it("limits every rsync to the bandwidth limit", () => {
    for (const n of [1, 2, 3]) mkRemote(n, { finished: false, done: [] });
    expect(pass({ BWLIMIT_KB: "12345" }).status, log()).toBe(0);
    expect(sb.fakeLog("rsync.log").length).toBeGreaterThanOrEqual(3);
    // the stub records its source and destination only: the option is on the supervisor's command line
    expect(readFileSync(join(sb.ops, "supervise.sh"), "utf8")).toContain('--bwlimit="$BWLIMIT"');
    expect(readFileSync(join(sb.ops, "supervise.sh"), "utf8")).toContain("BWLIMIT=${BWLIMIT_KB:-20000}");
  });

  it("marks all three final and tears down only when everything was pulled and validated; anc-copy dirs go to per-instance directories", () => {
    for (const n of [1, 2, 3]) mkRemote(n, n === 1 ? {} : { extra: ["runs/scaffold/hunt1/anc-copy/ponds/pond-cont/seed-4901401/ponds.tsv", "runs/scaffold/hunt1/anc-copy-c100/ponds/pond-cont/seed-4901401/ponds.tsv"] });
    const r = pass();
    expect(r.status, log()).toBe(0);
    expect([1, 2, 3].every((n) => sb.has(`final-${n}`)), log()).toBe(true);
    expect(sb.has("collision")).toBe(false);
    expect(sb.has("done")).toBe(true);
    expect(status()).toContain("DONE");
    for (const n of [1, 2, 3]) {
      const st = JSON.parse(sb.file(`status-${n}.json`));
      expect(st.instance).toBe(n);
      expect(Object.keys(st.commands).sort()).toEqual(CMDS(n).map((l) => l.split("|")[0]).sort());
      expect(spawnSync("tar", ["tzf", join(sb.ops, `remote-ops-${n}.tgz`)]).status).toBe(0);
      expect(readdirSync(sb.ops).some((f) => f.startsWith(`remote-ops-${n}.tgz.tmp`))).toBe(false);
      expect(existsSync(join(sb.root, `runs/scaffold/hunt1/device-inst${n}/device/ponds/pond-nat/seed-4905001/manifest.json`))).toBe(true);
      expect(existsSync(join(sb.root, `runs/scaffold/hunt1/hist/ponds/pond-nat/seed-${n}/ponds.tsv`))).toBe(true);
    }
    // never in the main tree; one directory per instance and per variant
    const hunt = join(sb.root, "runs/scaffold/hunt1");
    expect(readdirSync(hunt).filter((d) => d.startsWith("anc-copy"))).toEqual([]);
    for (const n of [2, 3]) for (const d of ["anc-copy", "anc-copy-c100"]) expect(readFileSync(join(sb.root, `runs/scaffold/hunt1-anc-copy/inst${n}/${d}/ponds/pond-cont/seed-4901401/ponds.tsv`), "utf8")).toContain(`of ${n}`);
    expect(existsSync(join(sb.root, "runs/scaffold/hunt1-anc-copy/inst1"))).toBe(false);
    // the collision list leaves them out
    expect(sb.file("files-2.txt")).not.toContain("anc-copy");
    expect(sb.file("files-2.txt")).not.toContain("device");
    expect(Object.values(sb.state().instances).every((i) => (i as { state: string }).state === "terminated")).toBe(true);
  });

  it("flags paths two instances wrote", () => {
    for (const n of [1, 2, 3]) mkRemote(n, { extra: ["runs/scaffold/hunt1/hist/ponds/pond-nat/seed-9/shared.tsv"] });
    expect(pass().status, log()).toBe(0);
    expect(sb.has("collision")).toBe(true);
    expect(status()).toContain("COLLISION");
  });

  describe("an instance is final only if every pull and validation of the pass succeeded", () => {
    // Every instance has ended its queue and has its anc-copy worlds; each of the three has one fault (or none, the control), so one pass tests three.
    const at = (n: number) => `10.0.0.${n}:bl/runs/scaffold/hunt1/`;
    const faults: [string, (n: number) => void, boolean][] = [
      ["no fault (control)", () => undefined, true],
      ["the main rsync fails", (n) => sb.rsyncRules([{ match: at(n), end: true, rc: 30 }]), false],
      ["the device pull fails", (n) => sb.rsyncRules([{ match: `${at(n)}device/`, rc: 30 }]), false],
      ["an anc-copy pull fails", (n) => sb.rsyncRules([{ match: `${at(n)}anc-copy/`, rc: 30 }]), false],
      ["an anc-copy-c100 pull fails", (n) => sb.rsyncRules([{ match: `${at(n)}anc-copy-c100/`, rc: 30 }]), false],
      ["the ops-log archive is not a tar file", (n) => sb.sshRules([{ match: "tar czf", host: `10.0.0.${n}`, stdout: "this is not a tar archive", rc: 0 }]), false],
      ["the ops-log archive transfer fails", (n) => sb.sshRules([{ match: "tar czf", host: `10.0.0.${n}`, rc: 255 }]), false],
      ["the status export is not JSON", (n) => sb.sshRules([{ match: "listdir", host: `10.0.0.${n}`, stdout: "not json", rc: 0 }]), false],
      ["the status export fails", (n) => sb.sshRules([{ match: "listdir", host: `10.0.0.${n}`, rc: 255 }]), false],
      ["the status lacks a command of the queue", (n) => rmSync(join(remote(n), "bl/ops/done", `h-b-${n}`)), false],
      ["the file list fails", (n) => sb.sshRules([{ match: "find .", host: `10.0.0.${n}`, rc: 255 }]), false],
      ["the instance is unreachable", (n) => sb.sshRules([{ match: "", host: `10.0.0.${n}`, rc: 255 }]), false],
    ];
    const batches = [0, 1, 2, 3].map((k) => faults.slice(3 * k, 3 * k + 3));
    it.each(batches.map((b, k) => [b.map((f) => f[0]).join(" | "), k] as const))("%s", (_name, k) => {
      for (const n of [1, 2, 3]) mkRemote(n, { extra: ["runs/scaffold/hunt1/anc-copy/ponds/pond-cont/seed-4901401/ponds.tsv", "runs/scaffold/hunt1/anc-copy-c100/ponds/pond-cont/seed-4901401/ponds.tsv"] });
      batches[k].forEach((f, i) => f[1](i + 1));
      expect(pass().status, log()).toBe(0);
      batches[k].forEach((f, i) => {
        const n = i + 1;
        expect(sb.has(`final-${n}`), `${f[0]} (instance ${n})\n${log()}`).toBe(f[2]);
        expect(status(), f[0]).toMatch(f[2] ? new RegExp(`i${n}=running:[^ ]*sync=1`) : new RegExp(`i${n}=running:[^ ]*(sync=0|unreachable)`));
        expect(readdirSync(sb.ops).filter((f) => new RegExp(`^(remote-ops|status|files)-${n}\\..*\\.tmp`).test(f)), "temporary outputs").toEqual([]);
      });
      expect(sb.has("done")).toBe(batches[k].every((f) => f[2]));
    });

    it("an invalid status export does not replace the one published", () => {
      for (const n of [1, 2, 3]) mkRemote(n, { finished: false, done: [] });
      expect(pass().status, log()).toBe(0);
      const good = sb.file("status-1.json");
      sb.sshRules([{ match: "listdir", host: "10.0.0.1", stdout: "garbage", rc: 0 }]);
      writeFileSync(join(sb.ops, "charged"), String(nowS()));
      expect(pass().status, log()).toBe(0);
      expect(sb.file("status-1.json")).toBe(good);
    });

    it("an instance still running its queue is not marked final, though everything pulled", () => {
      for (const n of [1, 2, 3]) mkRemote(n, { finished: false, done: ["devcheck-" + n] });
      expect(pass().status, log()).toBe(0);
      expect([1, 2, 3].some((n) => sb.has(`final-${n}`))).toBe(false);
      expect(status()).toMatch(/i1=running:1d\/0f\/3:fin=0:sync=1/);
    });
  });

  it("bounds every transfer by the pass limit: a hanging rsync is killed and charged by its time at the bandwidth limit, nothing hangs on, and the next pass starts with another instance", () => {
    for (const n of [1, 2, 3]) mkRemote(n);
    // pass 1 starts with instance 2 (order 2 3 1); its device pull hangs; the ledger starts at this pass, so only egress is charged
    sb.rsyncRules([{ match: "10.0.0.2:bl/runs/scaffold/hunt1/device/", hang: true }]);
    writeFileSync(join(sb.ops, "charged"), String(nowS()));
    const t0 = Date.now();
    expect(pass({ PASS_LIMIT: "10", BWLIMIT_KB: "1000000" }).status, log()).toBe(0);
    expect(Date.now() - t0).toBeLessThan(40_000);
    expect(sb.has("final-2")).toBe(false);
    const killed = log().match(/rsync of bl\/runs\/scaffold\/hunt1\/device\/ failed \(rc 124, (\d+) s\)/);
    expect(killed, log()).not.toBeNull();
    const secs = Number(killed![1]);
    expect(secs).toBeGreaterThanOrEqual(4);
    // charged secs x 1 GB/s x $0.09/GB (the other transfers report a few KB and add nothing visible)
    const want = (secs * 1_000_000 * 1024 * 0.09) / 1e9;
    expect(cost()).toBeGreaterThan(want - 0.01);
    expect(cost()).toBeLessThan(want + 0.3);
    expect(log()).toContain("instance 3: ssh failed (rc 99)");
    expect([1, 2, 3].some((n) => sb.has(`final-${n}`))).toBe(false);
    // no leftover stub processes
    expect(spawnSync("pgrep", ["-f", join(sb.bin, "rsync")], { encoding: "utf8" }).stdout.trim()).toBe("");
    // pass 2 starts with instance 3 (order 3 1 2): the instance that was starved goes first
    sb.clearRules();
    const seen = sb.fakeLog("ssh.log").length;
    writeFileSync(join(sb.ops, "charged"), String(nowS()));
    expect(pass().status, log()).toBe(0);
    expect(sb.fakeLog("ssh.log")[seen].startsWith("10.0.0.3:")).toBe(true);
    expect([1, 2, 3].every((n) => sb.has(`final-${n}`))).toBe(true);
  }, 120_000);

  it("re-checks the ledger before every transfer: a pass that crosses the cap in the middle stops transferring and tears down", () => {
    for (const n of [1, 2, 3]) mkRemote(n);
    // nothing left to reserve; $45.2 and a transfer's maximum ($0.66) is $45.86, under the stop, so the first transfers run; the first main pull
    // reports 5 GB ($0.45), and $45.65 + $0.66 is past $46, mid-way through instance 2's transfers
    deadlinesIn(-100);
    setCost(45.2);
    writeFileSync(join(sb.ops, "charged"), String(nowS()));
    sb.rsyncRules([{ match: "bl/runs/scaffold/hunt1/", end: true, received: 5_000_000_000 }]);
    expect(pass().status, log()).toBe(0);
    expect(sb.fakeLog("rsync.log")).toHaveLength(1);
    expect(sb.fakeLog("rsync.log")[0]).toContain("10.0.0.2:");
    expect(sb.fakeLog("ssh.log").filter((l) => l.includes("tar czf"))).toEqual([]);
    expect(log()).toContain("has reached the stop; no more transfers this pass");
    expect([1, 2, 3].some((n) => sb.has(`final-${n}`))).toBe(false);
    expect(sb.has("budget-stopped")).toBe(true);
    expect(sb.has("done")).toBe(true);
    expect(status()).toContain("budget spent");
    expect(Object.values(sb.state().instances).every((i) => (i as { state: string }).state === "terminated")).toBe(true);
  });

  describe("the supervisor's OS-held lock (flock on supervise.lock, released by the kernel)", () => {
    const supLock = () => join(sb.ops, "supervise.lock");

    it("a second pass exits at once while another process holds the lock, and nothing is deleted or recovered; once the holder is killed the next pass runs", () => {
      for (const n of [1, 2, 3]) mkRemote(n, { finished: false, done: [] });
      const holder = holdLock(supLock());
      const inode = statSync(supLock()).ino;
      try {
        const t0 = Date.now();
        expect(pass().status).toBe(0);
        expect(Date.now() - t0).toBeLessThan(5000);
        expect(sb.fakeLog("calls.log")).toEqual([]);
        expect(log()).toBe("");
        expect(statSync(supLock()).ino).toBe(inode);
      } finally {
        holder.kill();
      }
      expect(pass().status, log()).toBe(0);
      expect(sb.fakeLog("calls.log").length).toBeGreaterThan(0);
      expect(statSync(supLock()).ino).toBe(inode);
    });

    it("two passes at once: only one proceeds", () => {
      for (const n of [1, 2, 3]) mkRemote(n, { finished: false, done: [] });
      sb.rsyncRules([{ match: "10.0.0.2:bl/runs/scaffold/hunt1/", end: true, hang: true }]);
      const first = spawn("/bin/bash", [join(sb.ops, "supervise.sh")], { env: sb.env({ RETRY_PAUSE: "0", PASS_LIMIT: "10" }), cwd: sb.root, stdio: "ignore", detached: true });
      first.unref();
      for (let i = 0; i < 300 && sb.fakeLog("rsync.log").length === 0; i++) spawnSync("sleep", ["0.1"]);
      expect(sb.fakeLog("rsync.log")).toHaveLength(1);
      expect(pass({ PASS_LIMIT: "10" }).status).toBe(0);   // the first is mid-transfer: this one finds the lock taken
      expect(sb.file("pass-count").trim()).toBe("1");
      process.kill(-first.pid!, "SIGKILL");
    });

    it("no supervisor code deletes a lock file or recovers a stale one", () => {
      const code = readFileSync(join(sb.ops, "supervise.sh"), "utf8").split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n");
      expect(code).not.toMatch(/rm\s[^\n]*lock/);
      expect(code).not.toMatch(/mkdir\s[^\n]*lock/);
      expect(code).toContain("fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)");
    });
  });

  describe("transfers are debited before they start (a durable debit file; the ledger includes it) and settled after", () => {
    const debitFiles = (): string[] => readdirSync(sb.ops).filter((f) => f.startsWith("debit-") && !f.endsWith(".tmp")).sort();
    /** A pass killed (SIGKILL, the whole process group) as soon as one more rsync has started: or, if the pass tears down first, until it is done. */
    const interrupted = (alone = false): boolean => {
      const before = sb.fakeLog("rsync.log").length;
      writeFileSync(join(sb.ops, "charged"), String(nowS()));
      const p = spawn("/bin/bash", [join(sb.ops, "supervise.sh")], { env: sb.env({ RETRY_PAUSE: "0" }), cwd: sb.root, stdio: "ignore", detached: true });
      p.unref();
      for (let i = 0; i < 300 && sb.fakeLog("rsync.log").length === before && !sb.has("done"); i++) spawnSync("sleep", ["0.1"]);
      const started = sb.fakeLog("rsync.log").length > before;
      if (sb.has("done")) spawnSync("sleep", ["1"]);   // a pass that is tearing down gets to finish writing its status
      try {
        process.kill(alone ? p.pid! : -p.pid!, "SIGKILL");   // alone: the supervisor only, its transfer left running
      } catch {
        /* it had finished */
      }
      spawnSync("sleep", ["0.3"]);
      return started;
    };

    it("an interrupted transfer (the supervisor killed mid-rsync) leaves its full maximum charged and its debit file, and a restart does not refund it", () => {
      for (const n of [1, 2, 3]) mkRemote(n, { finished: false, done: [] });
      deadlinesIn(-100);   // nothing to reserve: the ledger is what is being tested
      writeFileSync(join(sb.ops, "charged"), String(nowS()));
      sb.rsyncRules([{ match: "10.0.0.2:bl/runs/scaffold/hunt1/", end: true, hang: true }]);
      expect(interrupted()).toBe(true);
      expect(debitFiles()).toEqual(["debit-1-2-main"]);
      const tmax = (20000 * 1024 * 360 * 0.09) / 1e9;   // 0.6636
      expect(num(sb.file("debit-1-2-main"))).toBeCloseTo(tmax, 3);
      // the ledger holds the whole maximum (the two small ssh transfers before it were settled to their actual bytes)
      expect(cost()).toBeGreaterThan(tmax - 0.001);
      expect(cost()).toBeLessThan(tmax + 0.05);
      expect(spawnSync("pgrep", ["-f", join(sb.bin, "rsync")], { encoding: "utf8" }).stdout.trim()).toBe("");
      const killedAt = cost();
      // the next pass: the kernel released the lock, the old debit stays charged (and shown), its own transfers settle
      sb.clearRules();
      writeFileSync(join(sb.ops, "charged"), String(nowS()));
      expect(pass().status, log()).toBe(0);
      expect(debitFiles()).toEqual(["debit-1-2-main"]);
      expect(cost()).toBeGreaterThan(killedAt - 0.001);
      expect(cost()).toBeLessThan(killedAt + 0.1);
      expect(status()).toContain("interrupted-debits:1");
    });

    it("a supervisor killed on its own leaves its transfer holding the lock: no pass runs until the orphan has exited, so its stale write cannot land over a newer pull", () => {
      for (const n of [1, 2, 3]) mkRemote(n, { finished: false, done: [] });
      deadlinesIn(-100);
      writeFileSync(join(sb.ops, "charged"), String(nowS()));
      const src = join(remote(2), "bl/runs/scaffold/hunt1/hist/ponds/pond-nat/seed-2/ponds.tsv");
      const dst = join(sb.root, "runs/scaffold/hunt1/hist/ponds/pond-nat/seed-2/ponds.tsv");
      writeFileSync(src, "v1\n");
      // instance 2's main pull snapshots v1, then dawdles for six seconds before it writes
      sb.rsyncRules([{ match: "10.0.0.2:bl/runs/scaffold/hunt1/", end: true, delay: 6 }]);
      try {
        expect(interrupted(true)).toBe(true);   // the supervisor is dead; its rsync (and the subshell waiting on it) live on
        expect(spawnSync("pgrep", ["-f", join(sb.bin, "rsync")], { encoding: "utf8" }).stdout.trim()).not.toBe("");
        // the instance now has newer results, and the replacement pass starts: it must find the lock taken
        writeFileSync(src, "v2\n");
        sb.clearRules();
        const rsyncs = sb.fakeLog("rsync.log").length;
        const callsBefore = sb.fakeLog("calls.log").length;
        expect(pass().status).toBe(0);
        expect(sb.file("pass-count").trim()).toBe("1");
        expect(sb.fakeLog("rsync.log")).toHaveLength(rsyncs);
        expect(sb.fakeLog("calls.log")).toHaveLength(callsBefore);
        expect(existsSync(dst)).toBe(false);   // nothing has been written yet: no pass pulled v2 under the orphan
        // the orphan finishes (it writes its v1 snapshot) and lets go of the lock
        for (let i = 0; i < 100 && spawnSync("pgrep", ["-f", join(sb.bin, "rsync")], { encoding: "utf8" }).stdout.trim() !== ""; i++) spawnSync("sleep", ["0.2"]);
        spawnSync("sleep", ["0.5"]);
        expect(readFileSync(dst, "utf8")).toBe("v1\n");
        // only now can a pass run, and it pulls v2 over v1: the destination is never left with the older snapshot
        writeFileSync(join(sb.ops, "charged"), String(nowS()));
        expect(pass().status, log()).toBe(0);
        expect(sb.file("pass-count").trim()).toBe("2");
        expect(readFileSync(dst, "utf8")).toBe("v2\n");
      } finally {
        spawnSync("pkill", ["-f", join(sb.bin, "rsync")]);
      }
    });

    it("the outputs published later (status, archive, file list) are written under per-pass temporary names, and a pass removes those of earlier passes", () => {
      for (const n of [1, 2, 3]) mkRemote(n, { finished: false, done: [] });
      writeFileSync(join(sb.ops, "status-2.json.tmp.7"), "stale");
      writeFileSync(join(sb.ops, "remote-ops-2.tgz.tmp.7"), "stale");
      writeFileSync(join(sb.ops, "files-2.txt.tmp.7"), "stale");
      expect(pass().status, log()).toBe(0);
      expect(readdirSync(sb.ops).filter((f) => /\.tmp\./.test(f))).toEqual([]);
      const code = readFileSync(join(sb.ops, "supervise.sh"), "utf8");
      expect(code).toContain('tmp="$O/status-$n.json.tmp.$k"');
      expect(code).toContain('tmp="$O/remote-ops-$n.tgz.tmp.$k"');
      expect(code).toContain('"$O/files-$n.txt.tmp.$k"');
      // the transfers keep the lock: only the short aws calls let go of fd 9
      expect(code.split("\n").filter((l) => l.includes("9>&-") && !l.trimStart().startsWith("#")).every((l) => l.startsWith("aws()"))).toBe(true);
    });

    it("repeated interruptions accumulate in the ledger and trip the teardown before $46", () => {
      for (const n of [1, 2, 3]) mkRemote(n, { finished: false, done: [] });
      deadlinesIn(-100);
      setCost(43.5);
      sb.rsyncRules([{ match: "bl/runs/scaffold/hunt1/", end: true, hang: true }]);
      let interruptions = 0;
      let highest = cost();
      for (let i = 0; i < 8 && !sb.has("done"); i++) {
        if (interrupted()) interruptions++;
        highest = Math.max(highest, cost());
      }
      // 43.5 -> 44.16 -> 44.83 -> 45.49: a fourth transfer would not fit under $46 with its maximum, so the next pass tears down
      expect(interruptions).toBeGreaterThanOrEqual(3);
      expect(debitFiles().length).toBe(interruptions);
      expect(highest).toBeLessThan(46);
      expect(cost()).toBeGreaterThan(45);
      expect(sb.has("done")).toBe(true);
      expect(sb.has("budget-stopped")).toBe(true);
      expect(status()).toContain("budget spent");
      expect(Object.values(sb.state().instances).every((i) => (i as { state: string }).state === "terminated")).toBe(true);
    });

    it("a completed transfer is settled to its actual: no debit file stays, the refund brings the ledger to the bytes it moved", () => {
      for (const n of [1, 2, 3]) mkRemote(n, { finished: false, done: [] });
      writeFileSync(join(sb.ops, "charged"), String(nowS()));
      sb.rsyncRules([{ match: "bl/runs/scaffold/hunt1/", end: true, received: 5_000_000_000 }]);
      expect(pass().status, log()).toBe(0);
      expect(debitFiles()).toEqual([]);
      expect(sb.fakeLog("rsync.log").length).toBeGreaterThanOrEqual(3);
      // 3 x 5 GB x $0.09 = 1.35, not 3 x the $0.66 maximum plus the rest
      expect(cost()).toBeGreaterThan(1.35 - 0.001);
      expect(cost()).toBeLessThan(1.35 + 0.05);
      expect(status()).not.toContain("interrupted-debits");
    });

    it("an excess over the maximum is charged, not refunded negatively", () => {
      for (const n of [1, 2, 3]) mkRemote(n, { finished: false, done: [] });
      writeFileSync(join(sb.ops, "charged"), String(nowS()));
      sb.rsyncRules([{ match: "bl/runs/scaffold/hunt1/", end: true, received: 20_000_000_000 }]);   // 20 GB: $1.80 > the $0.66 maximum
      expect(pass().status, log()).toBe(0);
      expect(debitFiles()).toEqual([]);
      expect(cost()).toBeGreaterThan(3 * 1.8 - 0.001);
      expect(cost()).toBeLessThan(3 * 1.8 + 0.05);
    });

    it("every ledger update is an atomic rename: no code writes the ledger in place", () => {
      const code = readFileSync(join(sb.ops, "supervise.sh"), "utf8");
      expect(code).toContain('printf "%.4f", v + a > (p ".tmp") }\' && mv -f "$O/cost.tmp" "$O/cost"');
      expect(code).not.toMatch(/>\s*"\$O\/cost"/);
      expect(code).toContain('mv -f "$DEBIT.tmp" "$DEBIT"');
    });
  });

  it("leaves a teardown pending until the key pair and the security group are confirmed deleted, and retries", () => {
    for (const n of [1, 2, 3]) mkRemote(n);
    sb.inject({ op: "delete-security-group", mode: "error:DependencyViolation", times: -1 });
    const r = pass();
    expect(r.status).toBe(1);
    expect(sb.has("done")).toBe(false);
    expect(status()).toContain("CLEANUP PENDING");
    expect(status()).toContain("security group: sg-0001");
    expect(sb.fakeLog("launchctl.log")).toEqual([]);
    expect(existsSync(join(sb.home, "Library", "LaunchAgents", "com.browser-life.scaf-hunt1.plist"))).toBe(true);
    expect(Object.values(sb.state().instances).every((i) => (i as { state: string }).state === "terminated")).toBe(true);
    expect(Object.keys(sb.state().keypairs)).toEqual([]);
    // the next pass goes straight to the teardown: no transfers, no new charges beyond its own interval, and it finishes once the group can go
    const rsyncs = sb.fakeLog("rsync.log").length;
    sb.edit((s) => (s.inject = []));
    expect(pass().status, log()).toBe(0);
    expect(sb.fakeLog("rsync.log")).toHaveLength(rsyncs);
    expect(sb.has("done")).toBe(true);
    expect(status()).toContain("DONE");
    expect(sb.fakeLog("launchctl.log")).toHaveLength(1);
    expect(Object.keys(sb.state().sgs)).toEqual([]);
  });

  it("does not report done when the cleanup lookups fail", () => {
    for (const n of [1, 2, 3]) mkRemote(n);
    sb.inject({ op: "describe-key-pairs", mode: "timeout", times: -1 });
    expect(pass().status).toBe(1);
    expect(sb.has("done")).toBe(false);
    expect(status()).toContain("CLEANUP PENDING");
  });

  it("never restarts a stopped instance: it is marked final and incomplete and teardown terminates it", () => {
    for (const n of [1, 2, 3]) mkRemote(n, { finished: false, done: [] });
    sb.edit((s) => (s.instances[ID(1)].state = "stopped"));
    expect(pass().status, log()).toBe(0);
    expect(sb.state().instances[ID(1)].state).toBe("stopped");
    expect(sb.calls("start-instances")).toEqual([]);
    expect(sb.has("restarts-1")).toBe(false);
    expect(sb.has("final-1")).toBe(true);
    expect(sb.has("incomplete-1")).toBe(true);
    expect(status()).toContain("STUCK i1");
    expect(readFileSync(join(sb.ops, "supervise.sh"), "utf8")).not.toContain("start-instances");
    // the other two finish; teardown terminates the stopped one too
    for (const n of [2, 3]) {
      mkRemote(n);
    }
    writeFileSync(join(sb.ops, "charged"), String(nowS()));
    expect(pass().status, log()).toBe(0);
    expect(sb.has("done")).toBe(true);
    expect(sb.state().instances[ID(1)].state).toBe("terminated");
    expect(sb.calls("start-instances")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// bootstrap.sh

describeOps("bootstrap.sh", () => {
  let sb: Sandbox;
  beforeEach(() => {
    sb = mkSandbox();
    sb.install("bootstrap.sh");
    writeFileSync(join(sb.ops, "instance-1"), "i-00000000000000001\n");
    writeFileSync(join(sb.ops, "deadline-1"), "1791066039\n");
    writeFileSync(join(sb.ops, "bl-src.tar.gz"), "x");
    writeFileSync(join(sb.ops, "ops-1.tgz"), "x");
    sb.edit((s) => (s.instances["i-00000000000000001"] = { name: "bl-scaf-hunt1-1", state: "running", type: "g5.xlarge", key: "bl-scaf-hunt1", launch: "2026-10-03T00:00:00+00:00", ip: "10.0.0.1" }));
    // the instance's side is the sandbox's rsh/rcp stand-ins: rsh logs and answers `test -e bootstrapped` from $FAKE/state-of-bootstrap
    writeFileSync(join(sb.ops, "rsh"), SH('shift; echo "rsh: $*" >> "$FAKE/rsh.log"\ncase "$*" in\n  *"/etc/bl-deadline"*) exit "$(cat "$FAKE/armed-rc" 2>/dev/null || echo 0)" ;;\n  *"test -e ~/bl/ops/bootstrapped"*) exit "$(cat "$FAKE/bootstrapped-rc" 2>/dev/null || echo 1)" ;;\nesac\nexit 0'));
    writeFileSync(join(sb.ops, "rcp"), SH('echo "rcp: $*" >> "$FAKE/rcp.log"'));
    chmodSync(join(sb.ops, "rsh"), 0o755);
    chmodSync(join(sb.ops, "rcp"), 0o755);
    // no waiting on a real instance
    writeFileSync(join(sb.bin, "sleep"), SH("exit 0"));
    chmodSync(join(sb.bin, "sleep"), 0o755);
  });
  const boot = () => sb.run(join(sb.ops, "bootstrap.sh"), ["1"], {}, { cwd: sb.ops });

  it("a first bootstrap copies and unpacks, installs cron and starts the lanes, and records that it is done", () => {
    const r = boot();
    expect(r.status, r.stderr).toBe(0);
    expect(sb.fakeLog("rcp.log")).toHaveLength(2);
    const script = sb.fakeLog("rsh.log").join("\n");
    expect(script).toContain("tar xzf bl-src.tar.gz");
    expect(script).toContain("crontab -");
    expect(script).toContain("bash ops/start.sh && touch ops/bootstrapped");
    expect(sb.file("ip-1").trim()).toBe("10.0.0.1");
  });

  it("a repeat on a bootstrapped instance only reinstalls cron and starts the missing lanes: no copy, no unpacking", () => {
    writeFileSync(join(sb.fake, "bootstrapped-rc"), "0");
    const r = boot();
    expect(r.status, r.stderr).toBe(0);
    expect(sb.fakeLog("rcp.log")).toEqual([]);
    const script = sb.fakeLog("rsh.log").join("\n");
    expect(script).not.toContain("tar xzf");
    expect(script).toContain("crontab -");
    expect(script).toContain("bash ~/bl/ops/start.sh");
  });

  it("stops on an unreachable instance rather than unpacking over a running one", () => {
    writeFileSync(join(sb.fake, "bootstrapped-rc"), "255");
    const r = boot();
    expect(r.status).toBe(1);
    expect(sb.fakeLog("rcp.log")).toEqual([]);
    expect(sb.fakeLog("rsh.log").join("\n")).not.toContain("tar xzf");
  });

  it("proves the deadline is armed before installing anything: the epoch in /etc/bl-deadline, the cron file and a scheduled shutdown", () => {
    expect(boot().status).toBe(0);
    const check = sb.fakeLog("rsh.log").find((l) => l.includes("/etc/bl-deadline"))!;
    expect(check).toContain('test "$(cat /etc/bl-deadline)" = 1791066039');
    expect(check).toContain("test -s /etc/cron.d/bl-deadline");
    expect(check).toContain("test -x /usr/local/sbin/bl-deadline-check");
    expect(check).toContain("test -e /run/systemd/shutdown/scheduled");
    // the check comes before anything is copied or installed
    const log = sb.fakeLog("rsh.log");
    expect(log.indexOf(check)).toBeLessThan(log.findIndex((l) => l.includes("mkdir -p ~/bl")));
  });

  describe("an instance whose deadline is not proven armed is terminated, and the termination confirmed", () => {
    it("terminates it through the API and waits for the termination, installing nothing", () => {
      writeFileSync(join(sb.fake, "armed-rc"), "1");
      const r = boot();
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("no armed deadline");
      expect(r.stderr).toContain("terminated (confirmed)");
      expect(sb.calls("terminate-instances")).toHaveLength(1);
      expect(sb.calls("terminate-instances")[0]).toContain("i-00000000000000001");
      expect(sb.calls("wait")).toHaveLength(1);
      expect(sb.state().instances["i-00000000000000001"].state).toBe("terminated");
      expect(sb.fakeLog("rcp.log")).toEqual([]);
      expect(sb.fakeLog("rsh.log").join("\n")).not.toContain("tar xzf");
      expect(sb.fakeLog("rsh.log").join("\n")).not.toContain("mkdir -p ~/bl");
    });

    it("says so loudly when the termination cannot be confirmed", () => {
      writeFileSync(join(sb.fake, "armed-rc"), "1");
      sb.inject({ op: "wait", mode: "error:WaiterError", times: -1 });
      const r = boot();
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("is NOT confirmed; terminate it by hand now");
      expect(sb.fakeLog("rcp.log")).toEqual([]);
    });

    it("an instance that never answers ssh is terminated too", () => {
      writeFileSync(join(sb.fake, "armed-rc"), "255");
      const r = boot();
      expect(r.status).toBe(1);
      expect(sb.calls("terminate-instances")).toHaveLength(1);
    });
  });

  it("does not bootstrap an instance whose deadline it does not know", () => {
    rmSync(join(sb.ops, "deadline-1"));
    const r = boot();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("no deadline-1");
    expect(sb.calls("terminate-instances")).toEqual([]);
    expect(sb.fakeLog("rcp.log")).toEqual([]);
  });

  it("stops when the instance has no public address", () => {
    sb.edit((s) => (s.instances["i-00000000000000001"].state = "stopped"));
    const r = boot();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("no public address");
    expect(sb.fakeLog("rcp.log")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// finish.sh

describeOps("finish.sh", () => {
  let sb: Sandbox;
  const H = () => join(sb.root, "runs/scaffold/hunt1");
  const queue = JSON.parse(readFileSync(join(REPO, "experiments/scaffold/hunt1-queue.json"), "utf8")) as { mac: { reproducibility: { reruns: { seed: number; cmd: string }[] } } };
  const reruns = queue.mac.reproducibility.reruns.map((r) => ({ seed: r.seed, cond: r.cmd.match(/--conditions (\S+)/)![1] }));
  beforeEach(() => {
    sb = mkSandbox();
    sb.install("finish.sh");
    mkdirSync(join(sb.root, "experiments/scaffold/readouts"), { recursive: true });
    copyFileSync(join(REPO, "experiments/scaffold/hunt1-queue.json"), join(sb.root, "experiments/scaffold/hunt1-queue.json"));
    writeFileSync(join(sb.ops, "done"), "");
    for (const n of [1, 2, 3]) writeFileSync(join(sb.ops, `status-${n}.json`), "{}");
    mkdirSync(join(H(), "hist"), { recursive: true });
  });
  const finish = () => sb.run(join(sb.ops, "finish.sh"), [], {}, { cwd: sb.ops });
  const runCalls = () => sb.fakeLog("deno.log").filter((l) => l.includes("tools/run.ts"));
  const reportCall = () => sb.fakeLog("deno.log").filter((l) => l.includes("tools/scaffold-report.ts")).pop() ?? "";
  const bundle = (exp: string, i: number) => join(H(), exp, "ponds", reruns[i].cond, `seed-${reruns[i].seed}`);
  const complete = (exp: string, i: number) => existsSync(join(bundle(exp, i), "manifest.json")) && "summary" in JSON.parse(readFileSync(join(bundle(exp, i), "manifest.json"), "utf8"));

  it("runs both reruns at census 1,000 and passes only repro when neither overflows", () => {
    const r = finish();
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(runCalls()).toHaveLength(2);
    expect(runCalls().every((l) => l.includes("--experiment repro ") && l.includes("--census 1000 "))).toBe(true);
    expect(complete("repro", 0) && complete("repro", 1)).toBe(true);
    expect(existsSync(join(H(), "repro-c100"))).toBe(false);
    const rep = reportCall();
    expect(rep).toContain("--repro runs/scaffold/hunt1/repro --queue");
    expect(rep).not.toContain("repro-c100");
    expect(readFileSync(join(sb.root, "experiments/scaffold/readouts/hunt1.json"), "utf8")).toContain("test outcome");
  });

  it("repeats a rerun that overflowed at census 100 under repro-c100 (same spec otherwise), keeps one complete rerun and gives both directories to the report", () => {
    writeFileSync(join(sb.fake, "overflow"), "repro:1000");
    const r = finish();
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const calls = runCalls();
    expect(calls).toHaveLength(4);
    for (let i = 0; i < 2; i++) {
      const c1000 = calls[2 * i], c100 = calls[2 * i + 1];
      expect(c100).toBe(c1000.replace("--experiment repro ", "--experiment repro-c100 ").replace("--census 1000 ", "--census 100 "));
      expect(complete("repro", i)).toBe(false);
      expect(complete("repro-c100", i)).toBe(true);
    }
    const rep = reportCall();
    expect(rep).toContain("--repro runs/scaffold/hunt1/repro runs/scaffold/hunt1/repro-c100 --queue");
  });

  it("does not repeat the census-1,000 run after an overflow, nor a complete rerun, when it is invoked again", () => {
    writeFileSync(join(sb.fake, "overflow"), "repro:1000");
    expect(finish().status).toBe(0);
    const n = runCalls().length;
    const again = finish();
    expect(again.status, again.stdout).toBe(0);
    expect(runCalls()).toHaveLength(n);
    // an interrupted state: the census-1,000 attempt left incomplete, the marker present, the census-100 rerun missing: only census 100 runs
    rmSync(join(H(), "repro-c100"), { recursive: true });
    const m = runCalls().length;
    expect(finish().status).toBe(0);
    const added = runCalls().slice(m);
    expect(added).toHaveLength(2);
    expect(added.every((l) => l.includes("--experiment repro-c100 ") && l.includes("--census 100 "))).toBe(true);
  });

  it("keeps exactly one complete rerun per history", () => {
    // a complete census-1,000 rerun and a complete census-100 one: the second is removed
    for (const exp of ["repro", "repro-c100"]) {
      for (let i = 0; i < 2; i++) {
        mkdirSync(bundle(exp, i), { recursive: true });
        writeFileSync(join(bundle(exp, i), "manifest.json"), JSON.stringify({ summary: {}, finishedAt: "t" }));
      }
    }
    const r = finish();
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(runCalls()).toEqual([]);
    expect(complete("repro", 0) && complete("repro", 1)).toBe(true);
    expect(existsSync(join(H(), "repro-c100", "ponds", reruns[0].cond, `seed-${reruns[0].seed}`))).toBe(false);
    expect(reportCall()).not.toContain("repro-c100");
  });

  it("stops on a rerun that fails for another reason, without the census-100 fallback", () => {
    const sb2 = sb;
    writeFileSync(join(sb2.bin, "deno"), SH('echo "$@" >> "$FAKE/deno.log"\necho "boom: out of memory" >&2\nexit 1'));
    const r = finish();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("rerun failed");
    expect(runCalls()).toHaveLength(1);
  });

  it("does nothing under a budget stop but the report", () => {
    writeFileSync(join(sb.ops, "budget-stopped"), "");
    const r = finish();
    expect(r.status, r.stdout).toBe(0);
    expect(runCalls()).toEqual([]);
    expect(reportCall()).toContain("--budget-stopped");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// the instance's start.sh and watchdog.sh (tools/hunt1-ops)

describe("start.sh and watchdog.sh on an instance", () => {
  let sb: Sandbox;
  const spawned: number[] = [];
  const bl = () => join(sb.home, "bl");
  const lanesLive = (): number[] => {
    const lines = tryRead(join(bl(), "ops/lanes.pids")).split("\n").filter(Boolean);
    return lines.map((l) => Number(l.split(" ")[1])).filter((p) => spawnSync("kill", ["-0", String(p)]).status === 0);
  };
  beforeEach(() => {
    sb = mkSandbox();
    mkdirSync(join(bl(), "ops"), { recursive: true });
    for (const f of ["start.sh", "watchdog.sh"]) copyFileSync(join(HUNT_OPS, f), join(bl(), "ops", f));
    // a lane stand-in: it only has to be a live process named ops/lane.sh
    writeFileSync(join(bl(), "ops/lane.sh"), SH('echo "lane $1" >> ops/lane-starts.log\nsleep 30 &\nc=$!\ntrap "kill $c" TERM EXIT\nwait'));
    writeFileSync(join(bl(), "ops/cmds.txt"), "a|-|x\nb|-|y\nc|-|z\n");
  });
  afterEach(() => {
    for (const p of [...lanesLive(), ...spawned.splice(0)]) spawnSync("kill", [String(p)]);
    // command groups the tests orphaned
    for (const g of existsSync(join(bl(), "ops/claims")) ? readdirSync(join(bl(), "ops/claims")) : []) {
      const f = join(bl(), "ops/claims", g, "pgid");
      if (existsSync(f)) spawnSync("bash", ["-c", "kill -9 -- -$0 2>/dev/null", readFileSync(f, "utf8").split(" ")[0]]);
    }
  });
  const start = (extra: Record<string, string> = {}) => sb.run(join(bl(), "ops/start.sh"), [], extra, { cwd: bl() });
  /** A claim: its lane pid, and the process group its command published ("<pgid> <boot id>"; the boot id is empty without /proc), if any. */
  const claim = (id: string, lane?: string, pgid?: string) => {
    mkdirSync(join(bl(), "ops/claims", id), { recursive: true });
    if (lane !== undefined) writeFileSync(join(bl(), "ops/claims", id, "lane"), lane);
    if (pgid !== undefined) writeFileSync(join(bl(), "ops/claims", id, "pgid"), `${pgid} \n`);
  };
  const aged = (id: string, secs = 3600) => {
    const old = new Date(Date.now() - secs * 1000);
    utimesSync(join(bl(), "ops/claims", id), old, old);
  };
  const exists = (p: string) => existsSync(join(bl(), p));
  /** A pid that is gone. */
  const deadPid = (): string => {
    const r = spawnSync("bash", ["-c", "echo $$"], { encoding: "utf8" });
    return r.stdout.trim();
  };
  /** A live process that is not a lane (a reused pid): its command line does not name ops/lane.sh. */
  const otherProcess = (): number => {
    const c = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
    c.unref();
    spawned.push(c.pid!);
    return c.pid!;
  };

  it("starts six lanes, then none on a repeat", () => {
    expect(start().status).toBe(0);
    const live = lanesLive();
    expect(live).toHaveLength(6);
    expect(tryRead(join(bl(), "ops/lanes.pids")).split("\n").filter(Boolean).map((l) => l.split(" ")[0])).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(start().status).toBe(0);
    expect(lanesLive().sort()).toEqual(live.sort());
    expect(tryRead(join(bl(), "ops/lanes.log"))).toContain("started 0 lanes (6 of 6 running)");
  });

  it("starts only the missing lanes", () => {
    expect(start().status).toBe(0);
    const live = lanesLive();
    spawnSync("kill", ["-9", String(live[1]), String(live[4])]);
    spawnSync("sleep", ["0.3"]);
    expect(lanesLive()).toHaveLength(4);
    expect(start().status).toBe(0);
    expect(lanesLive()).toHaveLength(6);
    expect(tryRead(join(bl(), "ops/lanes.log"))).toContain("started 2 lanes (6 of 6 running)");
  });

  describe("start.sh's OS-held lock (flock on ops/start.lock, released by the kernel)", () => {
    it("serialises concurrent starts: three at once start six lanes, not eighteen", async () => {
      const run = () => new Promise<number | null>((res) => spawn("/bin/bash", [join(bl(), "ops/start.sh")], { env: sb.env(), cwd: bl(), stdio: "ignore" }).on("close", res));
      await Promise.all([run(), run(), run()]);
      expect(lanesLive()).toHaveLength(6);
    });

    it("a contender waits briefly and then exits quietly, doing nothing, while another process holds the lock; the lock file is never deleted", () => {
      const lockFile = join(bl(), "ops/start.lock");
      mkdirSync(join(bl(), "ops"), { recursive: true });
      const holder = holdLock(lockFile);
      const inode = statSync(lockFile).ino;
      try {
        const t0 = Date.now();
        const r = start({ START_LOCK_WAIT: "1" });
        expect(r.status).toBe(0);
        expect(r.stderr).toBe("");
        expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
        expect(lanesLive()).toHaveLength(0);
        expect(exists("ops/lanes.pids") && tryRead(join(bl(), "ops/lanes.pids"))).toBeFalsy();
        expect(statSync(lockFile).ino).toBe(inode);
      } finally {
        holder.kill();
      }
      // the holder was killed: the kernel released the lock, and nothing had to be recovered or deleted
      expect(start().status).toBe(0);
      expect(lanesLive()).toHaveLength(6);
      expect(statSync(lockFile).ino).toBe(inode);
    });

    it("the lanes it starts do not inherit the lock: the next start gets it at once", () => {
      expect(start().status).toBe(0);
      expect(lanesLive()).toHaveLength(6);
      const t0 = Date.now();
      expect(start({ START_LOCK_WAIT: "20" }).status).toBe(0);
      expect(Date.now() - t0).toBeLessThan(15_000);
      expect(tryRead(join(bl(), "ops/lanes.log"))).toContain("started 0 lanes (6 of 6 running)");
    });

    it("no instance script deletes a lock file or recovers a stale one", () => {
      for (const f of ["start.sh", "watchdog.sh", "lane.sh"]) {
        const code = readFileSync(join(HUNT_OPS, f), "utf8").split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n");
        expect(code, f).not.toMatch(/rm\s[^\n]*lock/);
        expect(code, f).not.toMatch(/mkdir\s[^\n]*lock/);
      }
      expect(readFileSync(join(HUNT_OPS, "start.sh"), "utf8")).toContain("fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)");
    });
  });

  it("never deletes a claim whose lane is alive; clears one whose lane and group are gone (a dead lane, a reused pid, an old claim with no pid); keeps finished ones", () => {
    expect(start().status).toBe(0);
    const [alive] = lanesLive();
    claim("live", String(alive));
    claim("dead", deadPid(), deadPid());
    claim("reused", String(otherProcess()), deadPid());
    claim("nopid-old");
    aged("nopid-old");
    claim("nopid-fresh");
    claim("finished", deadPid(), deadPid());
    mkdirSync(join(bl(), "ops/done"), { recursive: true });
    writeFileSync(join(bl(), "ops/done/finished"), "");
    expect(start().status).toBe(0);
    expect(exists("ops/claims/live")).toBe(true);
    expect(exists("ops/claims/dead")).toBe(false);
    expect(exists("ops/claims/reused")).toBe(false);
    expect(exists("ops/claims/nopid-old")).toBe(false);
    expect(exists("ops/claims/nopid-fresh")).toBe(true);
    expect(exists("ops/claims/finished")).toBe(true);
  });

  describe("a claim whose lane is dead and that has no published group: the child may still be starting", () => {
    /** A process whose command line carries bl-claim:<id>, as a lane's child does until it has published its group. */
    const unregistered = (id: string): number => {
      const c = spawn("bash", ["-c", "sleep 30 & wait", `bl-claim:${id}`], { detached: true, stdio: "ignore" });
      c.unref();
      spawned.push(c.pid!);
      return c.pid!;
    };

    it("is kept while it is fresh, released when it is old and nothing carries its id, and kept when something does", () => {
      claim("fresh", deadPid());
      claim("old", deadPid());
      aged("old");
      claim("old-marked", deadPid());
      aged("old-marked");
      unregistered("old-marked");
      spawnSync("sleep", ["0.3"]);
      expect(start().status).toBe(0);
      expect(exists("ops/claims/fresh")).toBe(true);
      expect(exists("ops/claims/old")).toBe(false);
      expect(exists("ops/claims/old-marked")).toBe(true);
    });
  });

  it("a sweep takes start.sh's lock: it does nothing while another process holds it, and releases once the holder is gone", () => {
    claim("dead", deadPid(), deadPid());
    const lockFile = join(bl(), "ops/start.lock");
    const holder = holdLock(lockFile);
    const inode = statSync(lockFile).ino;
    try {
      expect(sb.run(join(bl(), "ops/watchdog.sh"), [], { LANES: "1", START_LOCK_WAIT: "1" }, { cwd: bl() }).status).toBe(0);
      expect(exists("ops/claims/dead")).toBe(true);
    } finally {
      holder.kill();
    }
    expect(sb.run(join(bl(), "ops/watchdog.sh"), [], { LANES: "1" }, { cwd: bl() }).status).toBe(0);
    expect(exists("ops/claims/dead")).toBe(false);
    expect(tryRead(join(bl(), "ops/lanes.log"))).toContain("start.sh released dead");
    expect(statSync(lockFile).ino).toBe(inode);
  });

  it("`start.sh sweep` releases dead claims and starts no lane", () => {
    claim("dead", deadPid(), deadPid());
    expect(start({}).status).toBe(0);   // a normal start also sweeps
    claim("dead2", deadPid(), deadPid());
    expect(sb.run(join(bl(), "ops/start.sh"), ["sweep"], { LANES: "6" }, { cwd: bl() }).status).toBe(0);
    expect(exists("ops/claims/dead2")).toBe(false);
    expect(lanesLive()).toHaveLength(6);   // the six of the first start, none added
    expect(tryRead(join(bl(), "ops/lanes.log")).split("\n").filter((l) => l.includes("started"))).toHaveLength(1);
  });

  it("clears the finished marker only when it starts lanes", () => {
    writeFileSync(join(bl(), "ops/finished"), "1");
    expect(start().status).toBe(0);
    expect(exists("ops/finished")).toBe(false);
    writeFileSync(join(bl(), "ops/finished"), "1");
    expect(start().status).toBe(0);
    expect(exists("ops/finished")).toBe(true);
  });

  describe("a command that outlives its lane (lane.sh gives each command a process group of its own)", () => {
    /** The real hunt lane.sh over a one-command queue, its lane killed once the command runs: the command survives as an orphan. */
    const orphan = (): { pgid: number; lane: number } => {
      copyFileSync(join(HUNT_OPS, "lane.sh"), join(bl(), "ops/lane.sh"));
      writeFileSync(join(bl(), "ops/cmds.txt"), "slow|-|sleep 60\n");
      const lane = spawn("/bin/bash", ["ops/lane.sh", "1"], { cwd: bl(), env: sb.env(), stdio: "ignore", detached: true });
      lane.unref();
      for (let i = 0; i < 50 && !exists("ops/claims/slow/pgid"); i++) spawnSync("sleep", ["0.1"]);
      expect(exists("ops/claims/slow/pgid")).toBe(true);
      const pgid = Number(readFileSync(join(bl(), "ops/claims/slow/pgid"), "utf8").split(" ")[0]);
      expect(Number(readFileSync(join(bl(), "ops/claims/slow/lane"), "utf8"))).toBe(lane.pid);
      spawnSync("kill", ["-9", String(lane.pid)]);
      spawnSync("sleep", ["0.2"]);
      expect(groupAlive(pgid)).toBe(true);
      return { pgid, lane: lane.pid! };
    };
    const groupAlive = (pgid: number): boolean => spawnSync("bash", ["-c", "kill -0 -- -$0", String(pgid)]).status === 0;
    const sweepers: [string, () => Result][] = [
      ["start.sh", () => start({ LANES: "1" })],
      ["watchdog.sh", () => sb.run(join(bl(), "ops/watchdog.sh"), [], { LANES: "1" }, { cwd: bl() })],
    ];

    it.each(sweepers.map(([n], i) => [n, i] as const))("%s keeps the claim of an orphaned command, and the command is not started a second time", (_n, i) => {
      const { pgid } = orphan();
      expect(sweepers[i][1]().status).toBe(0);
      expect(exists("ops/claims/slow")).toBe(true);
      expect(groupAlive(pgid)).toBe(true);
      spawnSync("sleep", ["1"]);
      expect(tryRead(join(bl(), "ops/lanes.log")).split("\n").filter((l) => l.includes("start slow"))).toHaveLength(1);
      expect(tryRead(join(bl(), "ops/lanes.log"))).not.toContain("released slow");
    });

    it.each(sweepers.map(([n], i) => [n, i] as const))("%s releases the claim once no process of the group is alive", (_n, i) => {
      const { pgid } = orphan();
      spawnSync("bash", ["-c", "kill -9 -- -$0", String(pgid)]);
      spawnSync("sleep", ["0.3"]);
      expect(groupAlive(pgid)).toBe(false);
      expect(sweepers[i][1]().status).toBe(0);
      expect(tryRead(join(bl(), "ops/lanes.log"))).toContain("released slow");
    });

    /** The real lane over a queue, run to completion (the lane exits when nothing is pending). */
    const lane = (cmds: string, env: Record<string, string> = {}) => {
      copyFileSync(join(HUNT_OPS, "lane.sh"), join(bl(), "ops/lane.sh"));
      writeFileSync(join(bl(), "ops/cmds.txt"), cmds);
      return sb.run(join(bl(), "ops/lane.sh"), ["1"], env, { cwd: bl(), timeout: 60_000 });
    };
    const dead = (pidFile: string): boolean => spawnSync("kill", ["-0", readFileSync(join(bl(), pidFile), "utf8").trim()]).status !== 0;

    it("kills what survives its leader before it retries the command, so a retry never overlaps a survivor", () => {
      // each try leaves a background child and fails; the second try must find the first's child gone
      const cmd = "flaky|-|if [ -f child.pid ] && kill -0 $(cat child.pid) 2>/dev/null; then echo alive > leak.flag; fi; sleep 300 & echo $! > child.pid; exit 3\n";
      expect(lane(cmd).status).toBe(0);
      expect(exists("leak.flag")).toBe(false);
      expect(tryRead(join(bl(), "ops/lanes.log"))).toContain("retry flaky rc=3");
      expect(readFileSync(join(bl(), "ops/fail/flaky"), "utf8").trim()).toBe("rc=3");
      expect(dead("child.pid")).toBe(true);
    });

    it("kills the survivors of a command that succeeded before it publishes done", () => {
      expect(lane("ok|-|sleep 300 & echo $! > child.pid; exit 0\n").status).toBe(0);
      expect(exists("ops/done/ok")).toBe(true);
      expect(dead("child.pid")).toBe(true);
    });

    it("escalates to KILL after the grace period for a survivor that ignores TERM, and waits until the group is empty", () => {
      const t0 = Date.now();
      expect(lane('stubborn|-|bash -c "trap \\"\\" TERM; sleep 300" & echo $! > child.pid; sleep 0.2; exit 3\n', { REAP_GRACE: "2" }).status).toBe(0);
      // two reaps (the command and its retry), each waiting out the grace period
      expect(Date.now() - t0).toBeGreaterThanOrEqual(3500);
      expect(exists("ops/fail/stubborn")).toBe(true);
      expect(dead("child.pid")).toBe(true);
    });

    describe("the child registers its group and checks the claim before it runs the command", () => {
      /** The lane with the child delayed (SETSID_DELAY) so that the claim can be changed under it. */
      const delayed = (change: () => void) => {
        copyFileSync(join(HUNT_OPS, "lane.sh"), join(bl(), "ops/lane.sh"));
        writeFileSync(join(bl(), "ops/cmds.txt"), "slow|-|echo ran > ran\n");
        const l = spawn("/bin/bash", ["ops/lane.sh", "1"], { cwd: bl(), env: sb.env({ SETSID_DELAY: "2" }), stdio: "ignore", detached: true });
        l.unref();
        spawned.push(l.pid!);
        for (let i = 0; i < 50 && !exists("ops/claims/slow/lane"); i++) spawnSync("sleep", ["0.1"]);
        change();
        for (let i = 0; i < 80 && !tryRead(join(bl(), "ops/lanes.log")).includes("lost claim"); i++) spawnSync("sleep", ["0.1"]);
      };

      it("does not run the command if the claim was removed meanwhile (a sweeper released it)", () => {
        delayed(() => rmSync(join(bl(), "ops/claims/slow"), { recursive: true }));
        expect(exists("ran")).toBe(false);
        expect(tryRead(join(bl(), "ops/lanes.log"))).toContain("lost claim slow; not publishing");
        expect(exists("ops/done/slow") || exists("ops/fail/slow")).toBe(false);
      });

      it("does not run the command if the claim is no longer this lane's", () => {
        delayed(() => writeFileSync(join(bl(), "ops/claims/slow/lane"), "424242"));
        expect(exists("ran")).toBe(false);
        expect(tryRead(join(bl(), "ops/lanes.log"))).toContain("lost claim slow; not publishing");
        expect(exists("ops/done/slow") || exists("ops/fail/slow")).toBe(false);
      });

      it("publishes the group before the command runs, and the command carries the claim's marker until then", () => {
        copyFileSync(join(HUNT_OPS, "lane.sh"), join(bl(), "ops/lane.sh"));
        // the command records whether its group was already published when it started
        writeFileSync(join(bl(), "ops/cmds.txt"), "pub|-|cat ops/claims/pub/pgid > seen-pgid; echo $$ > own-pid\n");
        expect(sb.run(join(bl(), "ops/lane.sh"), ["1"], {}, { cwd: bl(), timeout: 60_000 }).status).toBe(0);
        expect(readFileSync(join(bl(), "seen-pgid"), "utf8").split(" ")[0]).toBe(readFileSync(join(bl(), "own-pid"), "utf8").trim());
        expect(readFileSync(join(HUNT_OPS, "lane.sh"), "utf8")).toContain('"bl-claim:$1"');
      });
    });

    it("records the process group of each command in its claim, in a group of its own", () => {
      copyFileSync(join(HUNT_OPS, "lane.sh"), join(bl(), "ops/lane.sh"));
      writeFileSync(join(bl(), "ops/cmds.txt"), "quick|-|echo $$ > pid-of-command; echo ok\n");
      expect(sb.run(join(bl(), "ops/lane.sh"), ["1"], {}, { cwd: bl(), timeout: 30_000 }).status).toBe(0);
      expect(exists("ops/done/quick")).toBe(true);
      const [pgid] = readFileSync(join(bl(), "ops/claims/quick/pgid"), "utf8").split(" ");
      expect(pgid).toBe(readFileSync(join(bl(), "pid-of-command"), "utf8").trim());
      expect(readFileSync(join(bl(), "ops/logs/quick.log"), "utf8")).toBe("ok\n");
    });

    it("a failed command is retried once, except the device check", () => {
      copyFileSync(join(HUNT_OPS, "lane.sh"), join(bl(), "ops/lane.sh"));
      writeFileSync(join(bl(), "ops/cmds.txt"), "devcheck-1|-|echo x >> tries-dev; exit 3\nh-1|-|echo x >> tries-h; exit 4\n");
      expect(sb.run(join(bl(), "ops/lane.sh"), ["1"], {}, { cwd: bl(), timeout: 30_000 }).status).toBe(0);
      expect(readFileSync(join(bl(), "tries-dev"), "utf8").trim().split("\n")).toHaveLength(1);
      expect(readFileSync(join(bl(), "tries-h"), "utf8").trim().split("\n")).toHaveLength(2);
      expect(readFileSync(join(bl(), "ops/fail/devcheck-1"), "utf8").trim()).toBe("rc=3");
      expect(readFileSync(join(bl(), "ops/fail/h-1"), "utf8").trim()).toBe("rc=4");
    });
  });

  describe("watchdog.sh", () => {
    const dog = (extra: Record<string, string> = {}) => sb.run(join(bl(), "ops/watchdog.sh"), [], extra, { cwd: bl() });
    const sudo = () => sb.fakeLog("sudo.log");
    const stopLanes = () => {
      for (const p of lanesLive()) spawnSync("kill", [String(p)]);
    };

    it("never powers the instance off: not at a huge uptime, not long after the queue finished (terminate behaviour would destroy unpulled results)", () => {
      const up = join(sb.root, "uptime");
      writeFileSync(up, "999999.55 99999.00\n");
      for (const d of ["done", "fail"]) mkdirSync(join(bl(), "ops", d), { recursive: true });
      for (const id of ["a", "b"]) writeFileSync(join(bl(), "ops/done", id), "");
      writeFileSync(join(bl(), "ops/fail/c"), "rc=1");
      writeFileSync(join(bl(), "ops/finished"), String(Math.floor(Date.now() / 1000) - 7 * 24 * 3600));
      expect(dog({ UPTIME_FILE: up }).status).toBe(0);
      expect(sudo()).toEqual([]);
      const code = readFileSync(join(bl(), "ops/watchdog.sh"), "utf8").split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n");
      expect(code).not.toMatch(/poweroff|shutdown|halt|uptime/);
    });

    it("releases the claim of a dead lane and keeps a live one's, then restarts the lanes when commands are pending and none runs", () => {
      expect(start().status).toBe(0);
      const [alive] = lanesLive();
      claim("live", String(alive));
      claim("dead", deadPid(), deadPid());
      expect(dog().status).toBe(0);
      expect(exists("ops/claims/live")).toBe(true);
      expect(exists("ops/claims/dead")).toBe(false);
      expect(tryRead(join(bl(), "ops/lanes.log"))).toContain("released dead");
      // no lane left: pending commands, so it restarts them (start.sh's lock and live-claim rules apply)
      stopLanes();
      spawnSync("sleep", ["0.3"]);
      expect(dog().status).toBe(0);
      expect(tryRead(join(bl(), "ops/lanes.log"))).toContain("watchdog: no lane running; restarting");
      expect(lanesLive()).toHaveLength(6);
    });

    it("marks the queue finished once every command ended and no lane runs, and leaves the instance up", () => {
      for (const d of ["done", "fail"]) mkdirSync(join(bl(), "ops", d), { recursive: true });
      for (const id of ["a", "b"]) writeFileSync(join(bl(), "ops/done", id), "");
      writeFileSync(join(bl(), "ops/fail/c"), "rc=1");
      expect(dog().status).toBe(0);
      expect(exists("ops/finished")).toBe(true);
      const marked = readFileSync(join(bl(), "ops/finished"), "utf8");
      expect(dog().status).toBe(0);
      expect(readFileSync(join(bl(), "ops/finished"), "utf8")).toBe(marked);
      expect(sudo()).toEqual([]);
    });
  });
});
