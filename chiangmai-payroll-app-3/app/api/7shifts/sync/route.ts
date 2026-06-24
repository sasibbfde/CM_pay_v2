import {NextResponse} from 'next/server';
import {fetchTimePunches,fetchUsers} from '@/lib/7shifts';
export async function POST(req:Request){
 try{const body=await req.json().catch(()=>({})); const start=body.start||new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString(); const end=body.end||new Date().toISOString();
  const [users,punches]=await Promise.allSettled([fetchUsers(),fetchTimePunches(start,end)]);
  return NextResponse.json({ok:true,users:users.status==='fulfilled'?users.value:{error:users.reason.message},punches:punches.status==='fulfilled'?punches.value:{error:punches.reason.message},message:'Sync test completed. Map returned fields into Google Sheets Punches/Employees after first real API response.'});
 }catch(e:any){return NextResponse.json({ok:false,error:e.message},{status:500})}
}
