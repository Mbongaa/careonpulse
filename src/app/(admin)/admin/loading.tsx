import { Skeleton } from "@/components/ui/skeleton";

// Beheerpagina's zijn force-dynamic en lezen meerdere service-role-queries;
// zonder skeleton staart de beheerder naar een leeg scherm tot alles binnen is.
export default function AdminLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => `stat-${index}`).map((key) => (
          <Skeleton key={key} className="h-20 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
