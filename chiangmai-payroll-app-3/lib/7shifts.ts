const base='https://api.7shifts.com/v2';
async function sevenFetch(path:string){
 const token=process.env.SEVENSHIFTS_API_KEY; if(!token) throw new Error('Missing SEVENSHIFTS_API_KEY');
 const res=await fetch(`${base}${path}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},cache:'no-store'});
 if(!res.ok) throw new Error(`7shifts API error ${res.status}: ${await res.text()}`);
 return res.json();
}
export async function fetchTimePunches(start:string,end:string){
 const companyId=process.env.SEVENSHIFTS_COMPANY_ID; if(!companyId) throw new Error('Missing SEVENSHIFTS_COMPANY_ID');
 // Adjust params after first test with your account/API version if required.
 return sevenFetch(`/company/${companyId}/time_punches?clocked_in[gte]=${encodeURIComponent(start)}&clocked_in[lte]=${encodeURIComponent(end)}`);
}
export async function fetchUsers(){
 const companyId=process.env.SEVENSHIFTS_COMPANY_ID; if(!companyId) throw new Error('Missing SEVENSHIFTS_COMPANY_ID');
 return sevenFetch(`/company/${companyId}/users`);
}
