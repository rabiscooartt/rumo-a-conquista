import SagasClient from "@/app/sagas/SagasClient";
import { loadPublicCatalogInitialData } from "@/lib/homeInitialData";

export default async function SagasPage() {
  return <SagasClient initialCatalog={await loadPublicCatalogInitialData()} />;
}
