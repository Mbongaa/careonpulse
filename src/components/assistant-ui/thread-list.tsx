"use client";

import type { FC } from "react";

import { AuiIf, ThreadListItemMorePrimitive, ThreadListItemPrimitive, ThreadListPrimitive } from "@assistant-ui/react";
import { ArchiveIcon, MoreHorizontalIcon, PlusIcon, TrashIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export type ThreadListLabels = {
  archive?: string;
  delete?: string;
  loadingThreads?: string;
  moreOptions?: string;
  newChat?: string;
  newThread?: string;
};

export const ThreadList: FC<{ labels?: ThreadListLabels; onThreadSelect?: () => void }> = ({
  labels = {},
  onThreadSelect,
}) => {
  return (
    <ThreadListPrimitive.Root className="flex flex-col gap-1">
      <ThreadListNew label={labels.newThread ?? "Nieuwe chat"} onThreadSelect={onThreadSelect} />
      <AuiIf condition={(s) => s.threads.isLoading}>
        <ThreadListSkeleton label={labels.loadingThreads ?? "Chats laden"} />
      </AuiIf>
      <AuiIf condition={(s) => !s.threads.isLoading}>
        <ThreadListPrimitive.Items>
          {() => <ThreadListItem labels={labels} onThreadSelect={onThreadSelect} />}
        </ThreadListPrimitive.Items>
      </AuiIf>
    </ThreadListPrimitive.Root>
  );
};

const ThreadListNew: FC<{ label: string; onThreadSelect?: () => void }> = ({ label, onThreadSelect }) => {
  return (
    <ThreadListPrimitive.New asChild>
      <Button
        variant="outline"
        className="h-9 justify-start gap-2 rounded-lg px-3 text-sm hover:bg-muted data-active:bg-muted"
        onClick={onThreadSelect}
      >
        <PlusIcon className="size-4" />
        {label}
      </Button>
    </ThreadListPrimitive.New>
  );
};

const SKELETON_SLOTS = ["slot-1", "slot-2", "slot-3", "slot-4", "slot-5"];

const ThreadListSkeleton: FC<{ label: string }> = ({ label }) => {
  return (
    <div className="flex flex-col gap-1">
      {SKELETON_SLOTS.map((slot) => (
        <div key={slot} role="status" aria-label={label} className="flex h-9 items-center px-3">
          <Skeleton className="h-4 w-full" />
        </div>
      ))}
    </div>
  );
};

const ThreadListItem: FC<{ labels: ThreadListLabels; onThreadSelect?: () => void }> = ({ labels, onThreadSelect }) => {
  return (
    <ThreadListItemPrimitive.Root className="group flex h-9 items-center gap-2 rounded-lg transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none data-active:bg-muted">
      <ThreadListItemPrimitive.Trigger
        className="flex h-full min-w-0 flex-1 items-center px-3 text-start text-sm"
        onClick={onThreadSelect}
      >
        <span className="min-w-0 flex-1 truncate">
          <ThreadListItemPrimitive.Title fallback={labels.newChat ?? "Nieuwe chat"} />
        </span>
      </ThreadListItemPrimitive.Trigger>
      <ThreadListItemMore labels={labels} />
    </ThreadListItemPrimitive.Root>
  );
};

const ThreadListItemMore: FC<{ labels: ThreadListLabels }> = ({ labels }) => {
  return (
    <ThreadListItemMorePrimitive.Root>
      <ThreadListItemMorePrimitive.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="me-2 size-7 p-0 opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:bg-accent data-[state=open]:opacity-100 group-data-active:opacity-100"
        >
          <MoreHorizontalIcon className="size-4" />
          <span className="sr-only">{labels.moreOptions ?? "Meer opties"}</span>
        </Button>
      </ThreadListItemMorePrimitive.Trigger>
      <ThreadListItemMorePrimitive.Content
        side="bottom"
        align="start"
        className="z-50 min-w-32 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      >
        <ThreadListItemPrimitive.Archive asChild>
          <ThreadListItemMorePrimitive.Item className="flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground">
            <ArchiveIcon className="size-4" />
            {labels.archive ?? "Archiveren"}
          </ThreadListItemMorePrimitive.Item>
        </ThreadListItemPrimitive.Archive>
        <ThreadListItemPrimitive.Delete asChild>
          <ThreadListItemMorePrimitive.Item className="flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-destructive text-sm outline-none hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive">
            <TrashIcon className="size-4" />
            {labels.delete ?? "Verwijderen"}
          </ThreadListItemMorePrimitive.Item>
        </ThreadListItemPrimitive.Delete>
      </ThreadListItemMorePrimitive.Content>
    </ThreadListItemMorePrimitive.Root>
  );
};
