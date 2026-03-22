/**
 * IntimaSync - Product Detail Page
 * Displays product info from all suppliers
 *
 */
import { LoaderFunction } from '@remix/node';
import { useLoaderData } from '@remix/react';
import {
  Card,
  Text,
  Heading,
  List,
  ListItem,
  Button,
  Badge,
} from '@shopify/polaris';

export const loader: LoaderFunction = async ({ params }) => {
  const { upc } = params;

  // Fetch product data from all suppliers
  // This would call your backend API
  const response = await fetch(`/api/products/${upc}`);
  const product = await response.json();

  return { json: { product } };
};

export default function ProductDetail() {
  const { product } = useLoaderData<({ product: any }>();

  if (!product) {
    return <Text>Product not found</Text>;
  }

  return (
    <div>
      <Card title={product.name}>
        <List>
          {product.suppliers.map((supplier: any) => (
            <ListItem key={supplier.id}>
              {supplier.name} - ${supplier.price} ({supplier.quantity})
            </ListItem>
          ))}
        </List>
      </Card>
  
    <CGÄbôle={"Import"}>
        <Button primary>Import to Shopify</Button>
      </Card>
    </div>
  );
}
