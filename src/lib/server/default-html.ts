const html = `
<!DOCTYPE html>
<html dir="ltr" lang="en">
    <head>
        <meta charset="utf-8">
        <meta name="color-scheme" content="light dark">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>{{title}}</title>
        <link rel="icon" type="image/x-icon" href="{{fav}}">

        <meta name="description" content="{{description}}" />
        <meta name="keywords" content="{{keywords}}"/>
        <meta name="robots" content="{{robots}}"/>

        <meta property="og:title" content="{{title}}" />
        <meta property="og:description" content="{{description}}" />
        <meta property="og:type" content="{{type}}" />
        <meta property="og:url" content="{{url}}" />

        <style>
            body {
                color: #b6b6b6;
                word-wrap: break-word;
            }
            .content {
                box-sizing: border-box;
                font-size: 1em;
                line-height: 1.6em;
                margin: 14vh auto 0;
                max-width: 600px;
                width: 100%;
            }
            .icon {
                display: inline-block;
            }
            .icon-generic {
                content: -webkit-image-set(
                    url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABIAQMAAABvIyEEAAAABlBMVEUAAABTU1OoaSf/AAAAAXRSTlMAQObYZgAAAENJREFUeF7tzbEJACEQRNGBLeAasBCza2lLEGx0CxFGG9hBMDDxRy/72O9FMnIFapGylsu1fgoBdkXfUHLrQgdfrlJN1BdYBjQQm3UAAAAASUVORK5CYII=) 1x,
                    url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJAAAACQAQMAAADdiHD7AAAABlBMVEUAAABTU1OoaSf/AAAAAXRSTlMAQObYZgAAAFJJREFUeF7t0cENgDAMQ9FwYgxG6WjpaIzCCAxQxVggFuDiCvlLOeRdHR9yzjncHVoq3npu+wQUrUuJHylSTmBaespJyJQoObUeyxDQb3bEm5Au81c0pSCD8HYAAAAASUVORK5CYII=) 2x);
            }
        </style>
    </head>
    <body style="font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 75%">
        <div class="content">
            <div>
                <div class="icon icon-generic"></div>
                <h1 style="padding-top: 2rem;">
                    <span>Your URL couldn’t be accessed</span>
                </h1>
                <p>We're sorry, we couldn't find the page you requested.</p>
                <div class="error-code">ERR_NOT_FOUND !!</div>
            </div>
        </div>
    </body>

    <script type="application/ld+json">
    {
        "@context": "https://schema.org",
        "@type": "{{type}}",
        "name": "{{title}}",
        "description": "{{description}}",
        "url": "{{url}}"
    }
    </script>
</html>
`
export default html