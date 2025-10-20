const termsOfService = require('../data/termsOfService');
const privacyPolicy = require('../data/privacyPolicy');
const logger = require('../config/logger');

/**
 * Legal Document Controller
 * Handles requests for Terms of Service and Privacy Policy
 */

// Get Terms of Service
const getTermsOfService = (req, res) => {
  try {
    const format = req.query.format || 'json';

    if (format === 'html') {
      // Convert markdown to HTML for web display
      const htmlContent = convertMarkdownToHTML(termsOfService.content);
      res.status(200).send(htmlContent);
    } else if (format === 'text') {
      // Return plain text
      res.status(200).type('text/plain').send(termsOfService.content);
    } else {
      // Return JSON (default)
      res.status(200).json({
        status: 'success',
        data: {
          title: 'Terms of Service',
          version: termsOfService.version,
          effectiveDate: termsOfService.effectiveDate,
          lastUpdated: termsOfService.lastUpdated,
          content: termsOfService.content
        }
      });
    }

    logger.info('Terms of Service retrieved', {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      format
    });
  } catch (error) {
    logger.error('Error retrieving Terms of Service:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve Terms of Service'
    });
  }
};

// Get Privacy Policy
const getPrivacyPolicy = (req, res) => {
  try {
    const format = req.query.format || 'json';

    if (format === 'html') {
      // Convert markdown to HTML for web display
      const htmlContent = convertMarkdownToHTML(privacyPolicy.content);
      res.status(200).send(htmlContent);
    } else if (format === 'text') {
      // Return plain text
      res.status(200).type('text/plain').send(privacyPolicy.content);
    } else {
      // Return JSON (default)
      res.status(200).json({
        status: 'success',
        data: {
          title: 'Privacy Policy',
          version: privacyPolicy.version,
          effectiveDate: privacyPolicy.effectiveDate,
          lastUpdated: privacyPolicy.lastUpdated,
          content: privacyPolicy.content
        }
      });
    }

    logger.info('Privacy Policy retrieved', {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      format
    });
  } catch (error) {
    logger.error('Error retrieving Privacy Policy:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve Privacy Policy'
    });
  }
};

// Get all legal documents metadata
const getLegalDocuments = (req, res) => {
  try {
    res.status(200).json({
      status: 'success',
      data: {
        termsOfService: {
          title: 'Terms of Service',
          version: termsOfService.version,
          effectiveDate: termsOfService.effectiveDate,
          lastUpdated: termsOfService.lastUpdated,
          endpoint: '/api/legal/terms'
        },
        privacyPolicy: {
          title: 'Privacy Policy',
          version: privacyPolicy.version,
          effectiveDate: privacyPolicy.effectiveDate,
          lastUpdated: privacyPolicy.lastUpdated,
          endpoint: '/api/legal/privacy'
        }
      }
    });
  } catch (error) {
    logger.error('Error retrieving legal documents metadata:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve legal documents metadata'
    });
  }
};

// Helper function to convert markdown to basic HTML
function convertMarkdownToHTML(markdown) {
  let html = markdown;

  // Convert headers
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');

  // Convert bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Convert italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Convert links
  html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank">$1</a>');

  // Convert lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Convert numbered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Convert line breaks
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');

  // Wrap in HTML structure
  html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ParkTayo - Legal Document</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 900px;
      margin: 0 auto;
      padding: 20px;
      background: #f8f9fa;
    }
    h1 {
      color: #7C3AED;
      border-bottom: 3px solid #7C3AED;
      padding-bottom: 10px;
      margin-top: 40px;
    }
    h2 {
      color: #7C3AED;
      margin-top: 30px;
      margin-bottom: 15px;
    }
    h3 {
      color: #5B21B6;
      margin-top: 20px;
      margin-bottom: 10px;
    }
    h4 {
      color: #6B7280;
      margin-top: 15px;
    }
    p {
      margin-bottom: 15px;
      text-align: justify;
    }
    ul, ol {
      margin-bottom: 15px;
      padding-left: 30px;
    }
    li {
      margin-bottom: 8px;
    }
    strong {
      color: #1F2937;
      font-weight: 600;
    }
    a {
      color: #7C3AED;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    hr {
      border: none;
      border-top: 1px solid #E5E7EB;
      margin: 30px 0;
    }
    .container {
      background: white;
      padding: 40px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    @media (max-width: 768px) {
      body {
        padding: 10px;
      }
      .container {
        padding: 20px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    ${html}
  </div>
</body>
</html>
  `;

  return html;
}

module.exports = {
  getTermsOfService,
  getPrivacyPolicy,
  getLegalDocuments
};
