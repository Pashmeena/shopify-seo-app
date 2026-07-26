import { assertNoUserErrors, runGraphql, type AdminClient } from "../shopify/admin.server";

/**
 * Thin wrapper over the Blog/Article Admin GraphQL API. PLPs publish as
 * blog articles (a deliberate simplification — see README) into a
 * dedicated blog the app creates on first publish.
 */

const BLOGS_QUERY = `#graphql
  query PlpBlogs {
    blogs(first: 50) { nodes { id handle } }
  }
`;

const BLOG_CREATE_MUTATION = `#graphql
  mutation PlpBlogCreate($blog: BlogCreateInput!) {
    blogCreate(blog: $blog) {
      blog { id handle }
      userErrors { field message }
    }
  }
`;

const ARTICLE_CREATE_MUTATION = `#graphql
  mutation PlpArticleCreate($article: ArticleCreateInput!) {
    articleCreate(article: $article) {
      article { id handle }
      userErrors { field message }
    }
  }
`;

const ARTICLE_UPDATE_MUTATION = `#graphql
  mutation PlpArticleUpdate($id: ID!, $article: ArticleUpdateInput!) {
    articleUpdate(id: $id, article: $article) {
      article { id handle }
      userErrors { field message }
    }
  }
`;

const ARTICLE_DELETE_MUTATION = `#graphql
  mutation PlpArticleDelete($id: ID!) {
    articleDelete(id: $id) {
      deletedArticleId
      userErrors { field message }
    }
  }
`;

const METAFIELDS_SET_MUTATION = `#graphql
  mutation PlpMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message }
    }
  }
`;

export async function ensureBlog(
  admin: AdminClient,
  handle: string,
  title = "Inspiration",
): Promise<{ id: string; handle: string }> {
  const data = await runGraphql<{ blogs: { nodes: { id: string; handle: string }[] } }>(
    admin,
    BLOGS_QUERY,
  );
  const existing = data.blogs.nodes.find((blog) => blog.handle === handle);
  if (existing) return existing;

  const created = await runGraphql<{
    blogCreate: {
      blog: { id: string; handle: string } | null;
      userErrors: { field?: string[] | null; message: string }[];
    };
  }>(admin, BLOG_CREATE_MUTATION, { blog: { title, handle } });
  assertNoUserErrors(created.blogCreate.userErrors, "blogCreate");
  if (!created.blogCreate.blog) throw new Error("blogCreate returned no blog");
  return created.blogCreate.blog;
}

export interface ArticleInput {
  blogId: string;
  title: string;
  handle: string;
  body: string;
  summary: string;
  tags: string[];
  authorName: string;
}

export async function createArticle(
  admin: AdminClient,
  input: ArticleInput,
): Promise<{ id: string; handle: string }> {
  const data = await runGraphql<{
    articleCreate: {
      article: { id: string; handle: string } | null;
      userErrors: { field?: string[] | null; message: string }[];
    };
  }>(admin, ARTICLE_CREATE_MUTATION, {
    article: {
      blogId: input.blogId,
      title: input.title,
      handle: input.handle,
      body: input.body,
      summary: input.summary,
      tags: input.tags,
      isPublished: true,
      author: { name: input.authorName },
    },
  });
  assertNoUserErrors(data.articleCreate.userErrors, "articleCreate");
  if (!data.articleCreate.article) throw new Error("articleCreate returned no article");
  return data.articleCreate.article;
}

export async function updateArticle(
  admin: AdminClient,
  articleId: string,
  input: Omit<ArticleInput, "blogId" | "handle">,
): Promise<void> {
  const data = await runGraphql<{
    articleUpdate: { userErrors: { field?: string[] | null; message: string }[] };
  }>(admin, ARTICLE_UPDATE_MUTATION, {
    id: articleId,
    article: {
      title: input.title,
      body: input.body,
      summary: input.summary,
      tags: input.tags,
      author: { name: input.authorName },
    },
  });
  assertNoUserErrors(data.articleUpdate.userErrors, "articleUpdate");
}

/** Remove a published article — used when its PLP page is deleted. */
export async function deleteArticle(admin: AdminClient, articleId: string): Promise<void> {
  const data = await runGraphql<{
    articleDelete: { userErrors: { field?: string[] | null; message: string }[] };
  }>(admin, ARTICLE_DELETE_MUTATION, { id: articleId });
  assertNoUserErrors(data.articleDelete.userErrors, "articleDelete");
}

export interface ArticleSeoInput {
  metaTitle: string;
  metaDescription: string;
  /** Shopify-native noindex: `seo.hidden = 1` also drops it from the sitemap. */
  noindex: boolean;
}

/**
 * SEO metafields set via metafieldsSet, which upserts by
 * (ownerId, namespace, key) — safe on first publish and every republish.
 * `global.title_tag` / `global.description_tag` are what themes read for
 * the SEO title/description of an article.
 */
export async function setArticleSeo(
  admin: AdminClient,
  articleId: string,
  input: ArticleSeoInput,
): Promise<void> {
  const data = await runGraphql<{
    metafieldsSet: { userErrors: { field?: string[] | null; message: string }[] };
  }>(admin, METAFIELDS_SET_MUTATION, {
    metafields: [
      {
        ownerId: articleId,
        namespace: "global",
        key: "title_tag",
        type: "single_line_text_field",
        value: input.metaTitle,
      },
      {
        ownerId: articleId,
        namespace: "global",
        key: "description_tag",
        type: "single_line_text_field",
        value: input.metaDescription,
      },
      {
        ownerId: articleId,
        namespace: "seo",
        key: "hidden",
        type: "number_integer",
        value: input.noindex ? "1" : "0",
      },
    ],
  });
  assertNoUserErrors(data.metafieldsSet.userErrors, "metafieldsSet(article SEO)");
}
