As of September 3, 2026, X API v2 can support the first two parts directly:

- save another user’s post by parsing its URL and calling `GET /2/tweets/:id`;
- create text/image posts with `POST /2/tweets`.

Scheduling is not a native v2 capability; the tool must schedule locally and call `POST /2/tweets` at the due time.

I searched official `docs.x.com` first. The X Developer Community search produced no usable indexed results, and direct forum fetching returned 403, so the conclusions below rely primarily on official documentation and primary package sources.

## 1. OAuth 2.0 PKCE

Use an OAuth 2.0 `Native App` client. X classifies Native Apps as public clients because desktop apps cannot safely protect a client secret. Use PKCE with `S256`.

Required scopes:

| Scope | Purpose |
|---|---|
| `tweet.read` | Read posts visible to the user |
| `tweet.write` | Create posts and reposts |
| `users.read` | Read user data, including expanded author usernames |
| `media.write` | Upload images/GIFs/videos |
| `offline.access` | Receive a refresh token and remain connected |

The authorization endpoint is:

```text
https://x.com/i/oauth2/authorize
```

The token endpoint is:

```text
https://api.x.com/2/oauth2/token
```

For a public client, the authorization-code exchange and refresh request include `client_id` in the form body. Do not embed a client secret in a desktop app. Confidential clients instead authenticate the token endpoint using HTTP Basic with `client_id:client_secret`.

X documents the default access-token lifetime as two hours. With `offline.access`, X issues a refresh token, but the current official documentation does not publish a numeric refresh-token lifetime or a formal rotation guarantee. Implement refresh defensively:

- honor the returned `expires_in`;
- persist a newly returned `refresh_token` atomically;
- assume the refresh token may be replaced or invalidated after refresh;
- fall back to interactive authorization if refresh returns `invalid_grant`.

The authorization code itself expires after 30 seconds.

For localhost callbacks, use exact matching. The current central Apps documentation specifically recommends:

```text
http://127.0.0.1:<port>/callback
```

rather than `localhost`. The host, port, path, and trailing slash must match exactly. Some X SDK pages still show `localhost` examples, so `127.0.0.1` is the safer registration choice.

Sources: [OAuth 2.0 PKCE reference](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code), [OAuth PKCE flow](https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token), [X app/client types and callbacks](https://docs.x.com/fundamentals/developer-apps).

## 2. `GET /2/tweets/:id`

A useful request is:

```text
GET https://api.x.com/2/tweets/{id}
  ?tweet.fields=attachments,article,author_id,note_tweet,referenced_tweets,text
  &expansions=author_id,attachments.media_keys,referenced_tweets.id
  &user.fields=username
  &media.fields=media_key,type,url,alt_text
```

Detection:

| Requirement | Inspect |
|---|---|
| Has media | `data.attachments.media_keys` exists and is non-empty |
| Media details | `includes.media`, enabled by `expansions=attachments.media_keys` |
| Article | `data.article` is present |
| Long-form/note post | `data.note_tweet` is present |
| Full text over 280 | `data.note_tweet.text` |
| Quote | `data.referenced_tweets[].type === "quoted"` |
| Repost/retweet | `type === "retweeted"` |
| Reply | `type === "replied_to"`; `in_reply_to_user_id` is also useful |
| Author username | `data.author_id`, matched to `includes.users[].id`; request `expansions=author_id&user.fields=username` |

The standard `data.text` may be only the normal-length representation. Use `note_tweet.text` for long-form posts.

A single-post lookup costs `$0.005` per returned Post resource. X’s `$0.001` Owned Read price does not apply to `GET /2/tweets/:id`; it applies to listed own-data endpoints such as `GET /2/users/{id}/tweets` when the ID belongs to the authenticated app owner. Repeated reads of the same resource are generally deduplicated within a 24-hour UTC window.

Sources: [Get Post by ID](https://docs.x.com/x-api/posts/get-post-by-id), [fields](https://docs.x.com/x-api/fundamentals/fields), [expansions](https://docs.x.com/x-api/fundamentals/expansions), [data dictionary](https://docs.x.com/x-api/fundamentals/data-dictionary), [pricing and Owned Reads](https://docs.x.com/x-api/getting-started/pricing).

## 3. `POST /2/tweets`

For text plus images, the body is:

```json
{
  "text": "Post text",
  "media": {
    "media_ids": ["1234567890123456789"]
  }
}
```

A successful response is HTTP `201` and includes:

```json
{
  "data": {
    "id": "1234567890123456789",
    "text": "Post text"
  }
}
```

The normal limit is 280 weighted characters. X API v2 supports long-form posts; eligible X Premium users can post up to 25,000 characters. The API request remains a normal `text` body—there is no separate scheduling or long-form flag.

URL counting:

- Every valid URL detected in post text counts as 23 characters.
- Mentions and hashtags do not trigger the URL price.
- Mentions and hashtags count normally.
- Attached media does not trigger the URL price.
- A valid HTTP/HTTPS URL in the text does trigger the URL price.

Current pay-per-use write prices are:

- post without URL: `$0.015`;
- post containing a URL: `$0.20`.

Sources: [Create Post](https://docs.x.com/x-api/posts/create-or-edit-post), [character counting](https://docs.x.com/fundamentals/counting-characters), [long-form API support](https://docs.x.com/changelog), [X Premium post limits](https://help.x.com/en/using-x/types-of-posts), [pricing](https://docs.x.com/x-api/getting-started/pricing).

## 4. `POST /2/media/upload`

For a normal image, use simple upload: one request containing either base64 media in JSON or raw bytes in multipart form.

Example JSON shape:

```json
{
  "media": "<base64-data>",
  "media_category": "tweet_image",
  "media_type": "image/png",
  "shared": false
}
```

For chunked upload, use:

1. initialize;
2. append one or more chunks;
3. finalize;
4. poll status if `processing_info` is returned.

The current v2 documentation exposes these as `/initialize`, `/{id}/append`, `/{id}/finalize`, and status operations. The older command-based form uses `INIT`, `APPEND`, `FINALIZE`, and `STATUS` on the upload route.

Image limits:

| Type | Limit |
|---|---:|
| JPG | 5 MB |
| PNG | 5 MB |
| WEBP | 5 MB |
| Static GIF | 5 MB |
| Animated GIF | 15 MB |

A post may contain up to four photos, one animated GIF, or one video.

Relevant media categories are:

```text
tweet_image
tweet_gif
tweet_video
dm_image
dm_gif
dm_video
subtitles
```

Use `tweet_image` for images attached to posts. `amplify_video` is intended for Ads use, not ordinary posts.

Media upload itself is not listed as a billable operation in X’s public pricing table. `POST /2/media/metadata` is listed at `$0.005` per request.

Alt text is not part of the upload body. Set it afterward through media metadata:

```json
{
  "id": "1234567890123456789",
  "metadata": {
    "alt_text": {
      "text": "Description of the image"
    }
  }
}
```

Alt text can be up to 1,000 characters. Retrieve it with `expansions=attachments.media_keys&media.fields=alt_text`.

Sources: [Media overview](https://docs.x.com/x-api/media/introduction), [upload media](https://docs.x.com/x-api/media/upload-media), [media best practices and limits](https://docs.x.com/x-api/media/quickstart/best-practices), [media metadata](https://docs.x.com/x-api/media/create-media-metadata).

## 5. Pay-per-use rate limits

For a single-user OAuth user token, the per-user limits are the most relevant:

| Endpoint | Per app | Per user |
|---|---:|---:|
| `GET /2/tweets/:id` | 450 / 15 min | 900 / 15 min |
| `POST /2/tweets` | 10,000 / 24 hr | 100 / 15 min |
| `POST /2/media/upload` | 50,000 / 24 hr | 500 / 15 min |
| `POST /2/media/upload/initialize` | 180,000 / 24 hr | 1,875 / 15 min |
| `POST /2/media/upload/:id/append` | 180,000 / 24 hr | 1,875 / 15 min |
| `POST /2/media/upload/:id/finalize` | 180,000 / 24 hr | 1,875 / 15 min |
| `GET /2/media/upload` status | 100,000 / 24 hr | 1,000 / 15 min |
| `POST /2/media/metadata` | 50,000 / 24 hr | 500 / 15 min |

Always honor `x-rate-limit-remaining` and `x-rate-limit-reset`; the Developer Console is authoritative if account-specific limits differ.

Source: [X API rate limits](https://docs.x.com/x-api/fundamentals/rate-limits).

## 6. Native scheduled posts

Confirmed: there is no documented native scheduled-post endpoint for ordinary user posts in X API v2.

`POST /2/tweets` publishes immediately and has no `scheduled_at` field. A desktop tool must maintain its own queue and invoke the endpoint at the scheduled time. If the desktop app is asleep or stopped, the post cannot be sent unless scheduling is delegated to a continuously running service.

Do not confuse this with older Ads API scheduled-tweet functionality; that is not the ordinary user-post API.

Sources: [X API endpoint overview](https://docs.x.com/x-api/overview), [Create Post request schema](https://docs.x.com/x-api/posts/create-or-edit-post).

## 7. TypeScript/Node libraries

The strongest current choice is X’s official SDK:

```bash
npm install @xdevplatform/xdk
```

The official TypeScript XDK supports OAuth 2.0 PKCE, typed responses, posts, users, media, pagination, and streaming. Its GitHub releases show `v0.6.6` as the latest release in July 2026.

`twitter-api-v2` by PLhery is still active enough to use. The current npm version is `1.29.1`, published in August 2026. It provides good v2 typings, OAuth helpers, pagination, and media helpers. However, its media helper documentation primarily targets the legacy v1.1 media-upload surface, so verify the exact endpoint behavior before relying on it for the newer v2 upload APIs.

Recommendation:

- use `@xdevplatform/xdk` for typed v2 endpoints and OAuth;
- use raw `fetch` for small unsupported or recently changed surfaces;
- use the official `twitter-text` package for accurate 280/25k weighted character validation.

Sources: [official TypeScript XDK](https://docs.x.com/tools/typescript-xdk), [XDK releases](https://github.com/xdevplatform/xdk-typescript/releases), [PLhery library](https://github.com/PLhery/node-twitter-api-v2), [npm package/version](https://www.npmjs.com/package/twitter-api-v2), [official character-counting library guidance](https://docs.x.com/fundamentals/counting-characters).