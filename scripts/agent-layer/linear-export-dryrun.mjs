// Linear → Kaneo 흡수 dry-run (KAN-10). 읽기 전용: 팀별 열림/닫힘 건수와 Linear 프로젝트 분포만 출력한다.
// 실행: LINEAR_API_KEY=... node scripts/agent-layer/linear-export-dryrun.mjs  (키 값은 절대 기록하지 않는다)
const key = process.env.LINEAR_API_KEY;
async function gql(query, variables={}) {
  const r = await fetch("https://api.linear.app/graphql", {method:"POST", headers:{"Content-Type":"application/json", Authorization:key}, body: JSON.stringify({query, variables})});
  const j = await r.json(); if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0,300)); return j.data;
}
const v = await gql(`{ viewer { name } organization { name } teams { nodes { id key name } } }`);
console.log("org:", v.organization.name, "viewer:", v.viewer.name);
for (const t of v.teams.nodes) {
  let after=null, open=0, closed=0, projects={};
  do {
    const d = await gql(`query($id:String!,$after:String){ team(id:$id){ issues(first:100, after:$after, includeArchived:true){ pageInfo{hasNextPage endCursor} nodes{ identifier state{type} project{name} } } } }`, {id:t.id, after});
    for (const i of d.team.issues.nodes) { const done = ["completed","canceled"].includes(i.state.type); done?closed++:open++; const p=i.project?.name??"(none)"; projects[p]=(projects[p]||0)+1; }
    after = d.team.issues.pageInfo.hasNextPage ? d.team.issues.pageInfo.endCursor : null;
  } while(after);
  console.log(`team ${t.key} (${t.name}): open=${open} closed=${closed}`, JSON.stringify(projects));
}
