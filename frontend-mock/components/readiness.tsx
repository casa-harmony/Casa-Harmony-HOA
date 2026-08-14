"use client";

import { useApi } from "@/lib/use-api";
import { useAuth } from "@/app/providers";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowRight, CheckCircle2 } from "lucide-react";
import Link from "next/link";

export interface ReadinessStage {
  id: string;
  label: string;
  completed: boolean;
  missing: string[];
  next_action_label: string;
  next_action_route: string;
}

export interface ReadinessData {
  tenant_id: string;
  current_stage: string;
  stages: ReadinessStage[];
}

export function useReadiness() {
  const { activeTenantId } = useAuth();
  return useApi<ReadinessData | null>(activeTenantId ? `/tenants/${activeTenantId}/readiness` : null, null);
}

export function ReadinessBanner() {
  const { data, loading } = useReadiness();
  
  if (loading || !data || data.current_stage === "LIVE") {
    return null;
  }
  
  const currentStage = data.stages.find(s => s.id === data.current_stage);
  if (!currentStage) return null;
  
  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 flex items-center justify-between text-amber-900 text-sm">
      <div className="flex items-center gap-3">
        <AlertCircle className="h-5 w-5 text-amber-600" />
        <div>
          <span className="font-semibold mr-2">Setup: {currentStage.label}</span>
          <span>{currentStage.missing[0] || "Action required"}</span>
        </div>
      </div>
      <Button asChild size="sm" variant="outline" className="bg-white hover:bg-amber-100 border-amber-300 text-amber-800">
        <Link href={currentStage.next_action_route}>
          {currentStage.next_action_label} <ArrowRight className="ml-2 h-4 w-4" />
        </Link>
      </Button>
    </div>
  );
}

export function ReadinessEmptyState({ requiredStage, fallback }: { requiredStage: string, fallback?: React.ReactNode }) {
  const { data, loading } = useReadiness();
  
  if (loading) return null;
  if (!data) return <>{fallback}</>;
  
  const stageIndex = data.stages.findIndex(s => s.id === requiredStage);
  const currentStageIndex = data.stages.findIndex(s => s.id === data.current_stage);
  
  if (stageIndex < 0) return <>{fallback}</>;
  
  // If the current stage is before the required stage, show the empty state
  if (currentStageIndex < stageIndex && data.current_stage !== "LIVE") {
    const blockingStage = data.stages[currentStageIndex];
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center border rounded-lg bg-slate-50 border-dashed">
        <div className="h-12 w-12 rounded-full bg-slate-200 flex items-center justify-center mb-4">
          <AlertCircle className="h-6 w-6 text-slate-500" />
        </div>
        <h3 className="text-lg font-semibold text-slate-900 mb-2">
          Locked until {blockingStage.label.toLowerCase()} is complete
        </h3>
        <p className="text-slate-500 max-w-md mb-6">
          You cannot use this feature yet because the community setup is incomplete. 
          {blockingStage.missing[0] && ` Missing: ${blockingStage.missing[0]}.`}
        </p>
        <Button asChild>
          <Link href={blockingStage.next_action_route}>
            {blockingStage.next_action_label}
          </Link>
        </Button>
      </div>
    );
  }
  
  return <>{fallback}</>;
}
