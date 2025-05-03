import base64
import io
import re
from typing import Tuple, Optional, Union
import numpy as np
from PIL import Image
from lxml import etree


def crop_png(image_data: bytes, padding: int = 20) -> bytes:
    """
    Crop a PNG image to remove excess whitespace.

    Args:
        image_data: Binary PNG data
        padding: Padding in pixels to add around the content

    Returns:
        Binary data of the cropped PNG
    """
    # Load the image from binary data
    image = Image.open(io.BytesIO(image_data))

    # Convert to numpy array for processing
    img_array = np.array(image)

    print(f"Image shape: {img_array.shape}, dtype: {img_array.dtype}")

    # Always use RGB channels to find non-white pixels, ignoring alpha if present
    print("Processing image using RGB channels only")

    # Extract RGB channels, ignoring alpha if it exists
    if len(img_array.shape) > 2:  # Color image
        # Use only the first 3 channels (RGB)
        rgb_array = img_array[:, :, :3]

        # Calculate "whiteness" - how close to white (255,255,255) each pixel is
        whiteness = np.sum(np.abs(rgb_array.astype(np.int32) - 255), axis=2)

        # Find pixels that are significantly non-white
        non_white_mask = whiteness > 30
        non_empty_rows = np.where(np.any(non_white_mask, axis=1))[0]
        non_empty_columns = np.where(np.any(non_white_mask, axis=0))[0]
    else:
        # This case shouldn't happen based on requirements
        print("Warning: Unexpected image format")
        non_empty_rows = np.array([])
        non_empty_columns = np.array([])

    print(
        f"non empty rows from {non_empty_rows[0] if len(non_empty_rows) > 0 else 'N/A'} to {non_empty_rows[-1] if len(non_empty_rows) > 0 else 'N/A'}"
    )
    print(
        f"non empty columns from {non_empty_columns[0] if len(non_empty_columns) > 0 else 'N/A'} to {non_empty_columns[-1] if len(non_empty_columns) > 0 else 'N/A'}"
    )

    # If there are no non-empty pixels, return the original image
    if len(non_empty_rows) == 0 or len(non_empty_columns) == 0:
        print("No content found in image, returning original")
        output = io.BytesIO()
        image.save(output, format="PNG")
        return output.getvalue()

    # Calculate the crop boundaries with padding
    crop_top = max(0, min(non_empty_rows) - padding)
    crop_bottom = min(img_array.shape[0], max(non_empty_rows) + padding + 1)
    crop_left = max(0, min(non_empty_columns) - padding)
    crop_right = min(img_array.shape[1], max(non_empty_columns) + padding + 1)

    print(
        f"Crop boundaries: top={crop_top}, bottom={crop_bottom}, left={crop_left}, right={crop_right}"
    )
    print(
        f"Original size: {img_array.shape[1]}x{img_array.shape[0]}, Cropped size: {crop_right - crop_left}x{crop_bottom - crop_top}"
    )

    # Crop the image
    cropped_image = image.crop((crop_left, crop_top, crop_right, crop_bottom))

    # Save to bytes
    output = io.BytesIO()
    cropped_image.save(output, format="PNG", dpi=(300,300))
    return output.getvalue()


def crop_svg(svg_data: bytes, padding: int = 20) -> bytes:
    """
    Crop an SVG image to remove excess whitespace.

    Args:
        svg_data: Binary SVG data
        padding: Padding in pixels to add around the content

    Returns:
        Binary data of the cropped SVG
    """
    # Parse the SVG
    svg_str = svg_data.decode("utf-8")
    root = etree.fromstring(svg_str.encode("utf-8"))

    # Find all elements with x, y, width, height attributes
    elements = root.xpath("//*[@x and @y and @width and @height]")

    if not elements:
        # Try to find elements with points (like polygons)
        elements = root.xpath("//*[@points]")

        if not elements:
            # If no elements with explicit coordinates, return original
            return svg_data

    # Initialize min/max coordinates
    min_x, min_y = float("inf"), float("inf")
    max_x, max_y = float("-inf"), float("-inf")

    # Process elements with x, y, width, height
    for elem in root.xpath("//*[@x and @y and @width and @height]"):
        x = float(elem.get("x", 0))
        y = float(elem.get("y", 0))
        width = float(elem.get("width", 0))
        height = float(elem.get("height", 0))

        min_x = min(min_x, x)
        min_y = min(min_y, y)
        max_x = max(max_x, x + width)
        max_y = max(max_y, y + height)

    # Process elements with points (like polygons)
    for elem in root.xpath("//*[@points]"):
        points_str = elem.get("points", "")
        points = re.findall(r"(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)", points_str)

        for x_str, y_str in points:
            x, y = float(x_str), float(y_str)
            min_x = min(min_x, x)
            min_y = min(min_y, y)
            max_x = max(max_x, x)
            max_y = max(max_y, y)

    # Process path elements
    for elem in root.xpath("//path[@d]"):
        path_data = elem.get("d", "")
        # This is a simplified approach - a full implementation would need to parse the path data
        # Extract coordinates from the path data
        coords = re.findall(
            r"[ML]\s*(\d+(?:\.\d+)?)[, ](\d+(?:\.\d+)?)", path_data
        )

        for x_str, y_str in coords:
            x, y = float(x_str), float(y_str)
            min_x = min(min_x, x)
            min_y = min(min_y, y)
            max_x = max(max_x, x)
            max_y = max(max_y, y)

    # If no valid coordinates found, return original
    if min_x == float("inf") or min_y == float("inf"):
        return svg_data

    # Add padding
    min_x = max(0, min_x - padding)
    min_y = max(0, min_y - padding)
    max_x = max_x + padding
    max_y = max_y + padding

    # Calculate new dimensions
    width = max_x - min_x
    height = max_y - min_y

    # Update the SVG viewBox and dimensions
    root.set("viewBox", f"{min_x} {min_y} {width} {height}")
    root.set("width", str(width))
    root.set("height", str(height))

    # Convert back to string
    return etree.tostring(root)


def process_image_data(data_url: str) -> Tuple[bytes, str]:
    """
    Process a data URL to extract the binary data and content type.

    Args:
        data_url: The data URL string

    Returns:
        Tuple of (binary_data, content_type)
    """
    # Check if it's a data URL
    if data_url.startswith("data:"):
        # Split the header from the base64 data
        header, encoded_data = data_url.split(",", 1)

        # Extract the content type
        content_type = header.split(";")[0].split(":")[1]

        # Decode the base64 data
        binary_data = base64.b64decode(encoded_data)
    else:
        # Assume it's already base64 encoded
        binary_data = base64.b64decode(data_url)

        # Try to determine content type from the binary data
        if binary_data.startswith(b"<svg"):
            content_type = "image/svg+xml"
        else:
            # Default to PNG
            content_type = "image/png"

    return binary_data, content_type


def crop_image(
    data_url: str, format_type: str = "auto", padding: int = 20
) -> Tuple[bytes, str]:
    """
    Crop an image from a data URL.

    Args:
        data_url: The data URL string
        format_type: 'png', 'svg', or 'auto' to determine from the data
        padding: Padding in pixels to add around the content

    Returns:
        Tuple of (cropped_binary_data, content_type)
    """
    # Process the data URL
    binary_data, content_type = process_image_data(data_url)

    # Determine the format if set to auto
    if format_type == "auto":
        if content_type == "image/svg+xml":
            format_type = "svg"
        else:
            format_type = "png"

    # Crop based on format
    if format_type == "svg":
        cropped_data = crop_svg(binary_data, padding)
        return cropped_data, "image/svg+xml"
    else:
        cropped_data = crop_png(binary_data, padding)
        return cropped_data, "image/png"
