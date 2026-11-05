import BibliotecaClient from "@/app/biblioteca/BibliotecaClient";
import { loadLibraryInitialData } from "@/lib/homeInitialData";

export default async function BibliotecaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ catalog, journeyRows }, params] = await Promise.all([
    loadLibraryInitialData(),
    searchParams,
  ]);
  const initialFilter = params.filtro ?? params.filter;
  const query = params.q;
  const initialSearch = typeof query === "string" ? query.trim() : "";

  return (
    <BibliotecaClient
      initialCatalog={catalog}
      initialJourneyRows={journeyRows}
      initialFilter={typeof initialFilter === "string" ? initialFilter : null}
      initialSearch={initialSearch}
    />
  );
}
