import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireWritableStaffForIntake } from "@/lib/staffGuard";
import { observeIntakeWorkflow } from "@/lib/workflowTracking";

const schema=z.discriminatedUnion("action",[
  z.object({action:z.literal("assign"),ownerUserId:z.string().min(1).nullable(),expectedOwnerUserId:z.string().nullable()}),
  z.object({action:z.literal("abandon"),reason:z.string().trim().min(3).max(500)}),
  z.object({action:z.literal("reopen")}),
  z.object({action:z.literal("confirm_delivery"),packetId:z.string().min(1),source:z.string().trim().min(10).max(500)}),
]);
export async function POST(req:NextRequest,ctx:{params:Promise<{id:string}>}) {
  const {id}=await ctx.params;
  const {user,provider,deny}=await requireWritableStaffForIntake(id);
  if(deny)return deny;
  const parsed=schema.safeParse(await req.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({error:"Choose an owner or record a reason for abandonment."},{status:400});
  const data=parsed.data;
  if(data.action==="confirm_delivery") {
    const current=await observeIntakeWorkflow(id);
    if(!current || current.stage!=="DELIVERY" || current.packetId!==data.packetId) return NextResponse.json({error:"The packet or workflow changed. Refresh and verify the current completed packet."},{status:409});
    const recorded=await prisma.$transaction(async tx=>{
      await tx.$executeRaw`UPDATE "Intake" SET "id"="id" WHERE "id"=${id}`;
      const intake=await tx.intake.findFirst({where:{id,providerId:provider!.id,status:"COMPLETED",archived:false},select:{contentRevision:true,generatedPdfs:{orderBy:{createdAt:"desc"},take:1,select:{id:true,contentRevision:true}}}});
      if(!intake || intake.generatedPdfs[0]?.id!==data.packetId || intake.generatedPdfs[0]?.contentRevision!==intake.contentRevision)return false;
      await tx.auditLog.create({data:{providerId:provider!.id,intakeId:id,userId:user!.id,event:"workflow_delivery_confirmed",detail:JSON.stringify({packetId:data.packetId,contentRevision:intake.contentRevision,source:data.source})}});
      return true;
    });
    if(!recorded)return NextResponse.json({error:"The packet changed. Refresh and verify the current version."},{status:409});
    await observeIntakeWorkflow(id);
    return NextResponse.json({ok:true});
  }
  if(data.action==="assign"&&data.ownerUserId) {
    const member=await prisma.userMembership.findFirst({where:{providerId:provider!.id,userId:data.ownerUserId,active:true,role:{not:"REVIEWER"}}});
    if(!member)return NextResponse.json({error:"Choose active staff from this provider."},{status:400});
  }
  const result=await prisma.$transaction(async tx=>{
    const changed=await tx.intake.updateMany({where:{id,providerId:provider!.id,...(data.action==="assign"?{workflowOwnerUserId:data.expectedOwnerUserId}:data.action==="abandon"?{submittedAt:null,abandonedAt:null}:{abandonedAt:{not:null}})},data:data.action==="assign"?{workflowOwnerUserId:data.ownerUserId}:{abandonedAt:data.action==="abandon"?new Date():null}});
    if(!changed.count)return false;
    await tx.auditLog.create({data:{providerId:provider!.id,intakeId:id,userId:user!.id,event:`workflow_${data.action}`,detail:JSON.stringify(data)}});
    return true;
  });
  if(!result)return NextResponse.json({error:"The case changed. Refresh before trying again. Only an unsubmitted intake can be marked abandoned."},{status:409});
  await observeIntakeWorkflow(id);
  return NextResponse.json({ok:true});
}
