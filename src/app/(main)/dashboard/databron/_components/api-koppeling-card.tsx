"use client";

import { useEffect, useRef, useState } from "react";

import { Check, Loader2, ShieldCheck } from "lucide-react";

import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { API_SUCCESS_COPY, EPD_PROVIDERS } from "@/data/careon/careon-databron";
import { cn } from "@/lib/utils";

type ConnectionState = "idle" | "busy" | "connected";

export function ApiKoppelingCard() {
  const { source, setSource } = useCareon();
  const [provider, setProvider] = useState(EPD_PROVIDERS[0]);
  const [apiKey, setApiKey] = useState("");
  const [connection, setConnection] = useState<ConnectionState>(source.mode === "api" ? "connected" : "idle");
  const timeoutRef = useRef<number | null>(null);

  // "Herstel demo-data" elsewhere resets the source; follow it here.
  useEffect(() => {
    if (source.mode !== "api" && connection === "connected") {
      setConnection("idle");
      setApiKey("");
    }
  }, [source.mode, connection]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  function activate() {
    if (apiKey.trim() === "" || connection !== "idle") return;
    setConnection("busy");
    // The audited sandbox connects after ~1.4s.
    timeoutRef.current = window.setTimeout(() => {
      setConnection("connected");
      setSource({ mode: "api", label: "API live", detail: `${provider.name} · sandbox` });
    }, 1400);
  }

  return (
    <Card>
      <CardHeader>
        <CardDescription>
          <Badge variant="outline">Stap 2 · fase 2</Badge>
        </CardDescription>
        <CardTitle>Live EPD-koppeling</CardTitle>
        <CardDescription>
          Na koppeling ververst het dashboard elke nacht automatisch, inclusief signaleringen en dossiercontroles.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {EPD_PROVIDERS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setProvider(option)}
              aria-pressed={provider.id === option.id}
              className={cn(
                "flex items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                provider.id === option.id ? "border-primary bg-primary/5" : "hover:bg-muted/40",
              )}
            >
              <span
                className="flex size-8 shrink-0 items-center justify-center rounded-md font-semibold text-white text-xs"
                style={{ background: option.color }}
              >
                {option.mark}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium text-sm">{option.name}</span>
                <span className="block truncate text-foreground/70 text-xs">{option.sub}</span>
              </span>
              {provider.id === option.id && <Check className="ml-auto size-4 shrink-0 text-primary" />}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="password"
            placeholder="API-sleutel of client-secret"
            aria-label="API-sleutel of client-secret"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            disabled={connection !== "idle"}
          />
          <Button
            onClick={activate}
            disabled={apiKey.trim() === "" || connection !== "idle"}
            className="sm:w-40"
            variant={connection === "connected" ? "outline" : "default"}
          >
            {connection === "busy" && (
              <>
                <Loader2 className="size-4 animate-spin" />
                Verbinden...
              </>
            )}
            {connection === "connected" && (
              <>
                <Check className="size-4" />
                Verbonden
              </>
            )}
            {connection === "idle" && "Test & activeer"}
          </Button>
        </div>

        {connection === "connected" && (
          <p role="status" className="text-emerald-700 text-sm dark:text-emerald-400">
            {API_SUCCESS_COPY}
          </p>
        )}

        <p className="flex items-start gap-2 text-muted-foreground text-xs">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
          Sleutels worden versleuteld opgeslagen; er zijn alleen leesrechten voor rapportage nodig.
        </p>
      </CardContent>
    </Card>
  );
}
