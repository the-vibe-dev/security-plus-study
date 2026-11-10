#!/usr/bin/env python3
"""Build reviewable study source packs using only the Python standard library."""
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile,ZIP_DEFLATED,ZipInfo
import csv,hashlib,io,json,shutil,subprocess,sys
ROOT=Path(__file__).resolve().parents[1]
ARCHIVE='security_plus_sy0_701_practical_site_upgrade.zip'

def csv_bytes(rows):
    output=io.StringIO(newline='');writer=csv.DictWriter(output,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows);return output.getvalue().encode()
def zip_bytes(files):
    stream=io.BytesIO()
    with ZipFile(stream,'w',ZIP_DEFLATED) as archive:
        for name,data in sorted(files.items()):
            info=ZipInfo(name,date_time=(2026,11,10,0,0,0));info.compress_type=ZIP_DEFLATED;archive.writestr(info,data)
    return stream.getvalue()
def json_bytes(value):return (json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode()
def render_quiz(rows):
    parts=['# Security+ study questions — v1.2.0\n\nUnofficial study material; verify uncertain points against trusted sources.\n']
    for row in rows:
        parts += [f"## {row['item_id']}\n\n{row['question']}\n"]
        parts += [f"- {letter.upper()}. {row['option_'+letter]}" for letter in 'abcdef' if row.get('option_'+letter)]
        parts += [f"\nAnswer: {row['correct_option']}\n\n{row['explanation']}\n",f"Study tip: {row.get('exam_tip','')}\n",f"Sources: {row.get('source_urls','')}\n"]
        parts += [f"{letter.upper()}: {row.get('rationale_'+letter,'')}\n" for letter in 'abcdef' if row.get('option_'+letter)]
    return '\n'.join(parts).encode()
def render_pbqs(pbqs,answers):
    out=['# Original Security+ PBQ '+('solutions' if answers else 'scenarios')+' — v1.2.0\n']
    for p in pbqs:
        out += [f"## {p['id']} — {p['title']}\n",p['scenario_md']]
        for exhibit in p['exhibits']:out += [f"### {exhibit['title']}\n",exhibit['content_md']]
        for task in p['tasks']:
            out += [f"### {task['id']}\n",task['prompt']]
            out += [f"- {o['id']}: {o['text']}" for o in task.get('options',[])]
        if answers:
            for key in p['answer_key']:out += [f"{key['task_id']}: {json.dumps(key['correct_response'])}\n\n{key['explanation']}\n"]
        out += ['References: '+', '.join(p.get('source_urls',[]))]
    return '\n\n'.join(out).encode()
with TemporaryDirectory(prefix='secplus-rebuild-') as directory:
    base=Path(directory)
    with ZipFile(ROOT/ARCHIVE) as archive:
        for entry in archive.infolist():
            target=(base/entry.filename).resolve()
            if not target.is_relative_to(base):raise SystemExit('Unsafe archive member')
            if entry.is_dir():target.mkdir(parents=True,exist_ok=True)
            else:target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(archive.read(entry))
    source=base/'security_plus_practical_expansion'
    shutil.copyfile(ROOT/'scripts/build-study-bank.py',source/'tools/build_package.py')
    # Keep Python reference command comparison semantically aligned with command-match.mjs.
    reference=source/'tools/reference_grader.py'
    text=reference.read_text()
    if 'def command_tokens' not in text:
        helper=(ROOT/'scripts/reference_command_match.py').read_text()
        text=text.replace('def _valid_unique_order',helper+'\ndef _valid_unique_order')
    text=text.replace("good_cmd=any(_norm(response.get('command',''))==_norm(c) for c in expected['accepted_commands'])", "good_cmd=any(command_tokens(response.get('command',''),item['interaction'].get('shell','bash'))==command_tokens(c,item['interaction'].get('shell','bash')) for c in expected['accepted_commands'])")
    text=text.replace("else:earned=round(points*sum(a==b for a,b in zip(response,expected))/len(expected),2)", "else:earned=max(round(points*sum(a==b for a,b in zip(response,order))/len(order),2) for order in key.get('valid_orders',[expected]))")
    reference.write_text(text)
    result=subprocess.run([sys.executable,str(source/'tools/build_package.py')],capture_output=True,text=True,check=True)
    subprocess.run([sys.executable,str(source/'tools/validate_package.py')],check=True)
    manifest=json.loads((source/'PACKAGE_MANIFEST.json').read_text());manifest.update(date='2026-11-10',release_version='1.2.0',content_revision='sy701-study-2026-11-10-r3')
    (source/'PACKAGE_MANIFEST.json').write_bytes(json_bytes(manifest))
    # Original prep packs, markdown study copies and their cryptographic manifests stay synchronized.
    for number,name,prefix,csvname,pbqname,manifestname in [(1,'security_plus_sy0_701_study_pack.zip','security_plus_sy0_701/','security_plus_quiz.csv','security_plus_pbqs.json','PACK_MANIFEST.json'),(2,'test_prep_2_security_plus_sy0_701.zip','test_prep_2_security_plus_sy0_701/','test_prep_2_quiz.csv','test_prep_2_pbqs.json','test_prep_2_manifest.json')]:
        with ZipFile(ROOT/name) as archive:files={n:archive.read(n) for n in archive.namelist() if not n.endswith('/')}
        rows=list(csv.DictReader((source/f'legacy/prep{number}_quiz.csv').open(newline='')))
        pbqs=json.loads((source/f'legacy/prep{number}_pbqs.json').read_text())['pbqs']
        files[prefix+csvname]=csv_bytes(rows);files[prefix+pbqname]=json_bytes({'schema_version':'securityplus.pbq.v1','pbqs':pbqs})
        for n in list(files):
            lower=n.lower()
            if 'quiz_review.md' in lower:files[n]=render_quiz(rows)
            if 'pbq_questions.md' in lower:files[n]=render_pbqs(pbqs,False)
            if 'pbq_answer_key.md' in lower:files[n]=render_pbqs(pbqs,True)
        m=json.loads(files[prefix+manifestname]);m['package_version']='1.2.0'
        m['files']=[{'name':n.removeprefix(prefix),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()} for n,data in sorted(files.items()) if n!=prefix+manifestname]
        files[prefix+manifestname]=json_bytes(m);(ROOT/name).write_bytes(zip_bytes(files))
    files={str(p.relative_to(base)):p.read_bytes() for p in source.rglob('*') if p.is_file() and '__pycache__' not in p.parts}
    (ROOT/ARCHIVE).write_bytes(zip_bytes(files))
print('Built all three study archives.')
