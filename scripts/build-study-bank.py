#!/usr/bin/env python3
"""Build derived study-bank files from the authored CSV, JSONL, and PBQ sources.
Run this file from tools/ inside an extracted practical study archive.
"""
from pathlib import Path
import collections,csv,json
ROOT=Path(__file__).resolve().parents[1]
NAMES={1:'General Security Concepts',2:'Threats, Vulnerabilities, and Mitigations',3:'Security Architecture',4:'Security Operations',5:'Security Program Management and Oversight'}
def read_rows(name):
    with (ROOT/name).open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
def read_lines(name):return [json.loads(line) for line in (ROOT/name).read_text().splitlines() if line.strip()]
def write_json(name,data):(ROOT/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
def write_lines(name,rows):(ROOT/name).write_text(''.join(json.dumps(row,ensure_ascii=False)+'\n' for row in rows))
def write_csv(name,rows,headers=None):
    with (ROOT/name).open('w',encoding='utf-8',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=headers or list(rows[0]),extrasaction='ignore');writer.writeheader();writer.writerows(rows)
items=read_lines('bank/interactive_public.jsonl')
keys=read_lines('answer_keys/interactive_private.jsonl')
rows=read_rows('legacy/prep1_quiz.csv')+read_rows('legacy/prep2_quiz.csv')+read_rows('bank/new_quiz_questions_257_private_import.csv')
assert len(items)==len(keys)==639 and len(rows)==857
public=[];private=[]
for row in rows:
    ident=row['item_id'];domain=int(row['domain_id'])
    options=[{'id':letter.upper(),'text':row['option_'+letter]} for letter in 'abcdef' if row.get('option_'+letter)]
    answer=[letter for letter in row['correct_option'] if letter in 'ABCDEF']
    public.append({'id':ident,'exam_code':'SY0-701','origin':'legacy-prep-1' if ident.startswith('SEC-Q') else 'legacy-prep-2' if ident.startswith('SEC2-Q') else 'securityplus-practical-expansion-v1','domain_id':domain,'domain_name':NAMES[domain],'objective_id':row['objective_id'],'topic':row.get('topic') or 'Foundational Security+','difficulty':row.get('difficulty','intermediate'),'question_kind':'multiple_choice','suggested_seconds':60,'points':1,'prompt':row['question'],'stimulus':{},'interaction':{'type':'multi_select' if len(answer)>1 else 'single_select','options':options,'select_count':len(answer)}})
    private.append({'id':ident,'answer':answer if len(answer)>1 else answer[0],'correct_answer':row['correct_answer'],'explanation':row.get('explanation',''),'rationales':{letter.upper():row.get('rationale_'+letter,'') for letter in 'abcdef' if row.get('option_'+letter)},'points':1,'grader':public[-1]['interaction']['type']})
write_lines('bank/knowledge_public.jsonl',public)
write_lines('answer_keys/knowledge_private.jsonl',private)
write_csv('legacy/merged_quiz_private_import.csv',rows)
headers=['index']+[field for field in rows[0] if field!='index']
write_csv('legacy/history_bowl_compatible_quiz_857_private_import.csv',[{'index':index+1,**row} for index,row in enumerate(rows)],headers)
columns=['id','exam_code','domain_id','objective_id','topic','question_kind','difficulty','points','interaction_type','prompt','stimulus_json','interaction_json']
write_csv('bank/interactive_index.csv',[{**q,'interaction_type':q['interaction']['type'],'stimulus_json':json.dumps(q['stimulus'],ensure_ascii=False),'interaction_json':json.dumps(q['interaction'],ensure_ascii=False)} for q in items],columns)
pbqs=[]
for number in [1,2]:pbqs.extend(json.loads((ROOT/f'legacy/prep{number}_pbqs.json').read_text())['pbqs'])
write_json('legacy/legacy_pbqs_private_import.json',{'schema_version':'securityplus.pbq.v1','pbqs':pbqs})
by_id={q['id']:q for q in public+items};used=set()
for number in range(1,11):
    name=f'exams/exam_{number:02d}.json';exam=json.loads((ROOT/name).read_text())
    assert len(exam['items'])==90
    domains=collections.Counter()
    for entry in exam['items']:
        assert entry['id'] in by_id and entry['id'] not in used
        used.add(entry['id']);domains[by_id[entry['id']]['domain_id']]+=1
    exam['blueprint']={'domain_target_counts':{str(d):domains[d] for d in range(1,6)},'notes':'Actual practice distribution. These exercises do not reproduce an official exam blueprint or scoring.'}
    write_json(name,exam)
assert len(used)==900
manifest=json.loads((ROOT/'PACKAGE_MANIFEST.json').read_text())
manifest.update(date='2026-11-07',release_version='1.1.0',content_revision='sy701-study-2026-11-07-r2',new_by_domain={str(d):sum(q['domain_id']==d for q in items) for d in range(1,6)})
write_json('PACKAGE_MANIFEST.json',manifest)
print('Study bank v1.1.0: 857 knowledge questions, 639 interactive items, 50 PBQs; 10 fixed exam manifests.')
