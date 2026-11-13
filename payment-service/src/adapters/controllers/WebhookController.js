// HTTP → use case. The route has already verified the provider signature and parsed
// the event into the domain's vocabulary.
class WebhookController {
  #handleProviderWebhook;

  constructor({ handleProviderWebhook }) {
    this.#handleProviderWebhook = handleProviderWebhook;
  }

  receive = async (event) => this.#handleProviderWebhook.execute(event);
}

module.exports = { WebhookController };
